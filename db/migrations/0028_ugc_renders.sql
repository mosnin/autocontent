-- 0028: UGC studio renders (script + reference images -> spokesperson ad).
--
-- A standalone lane, not the niche/scene video pipeline: one row is one
-- MUAPI render job. niche_id is OPTIONAL (nullable) because a UGC ad is
-- frequently a one-off for a client or a product and belongs to no
-- channel; when it is set, the niche's daily spend cap applies.
--
-- Lifecycle: queued -> running -> done | failed. The provider completes
-- the job asynchronously and calls our webhook, which matches on
-- provider_request_id; the unique index on that column is what makes the
-- webhook idempotent and is why a duplicate delivery cannot fan out.

create table if not exists ugc_renders (
    id            uuid primary key default gen_random_uuid(),
    user_id       text not null references users(id) on delete cascade,
    -- Optional channel attribution; drives per-niche cap + cost reporting.
    niche_id      uuid references niches(id) on delete set null,

    -- Catalog model id (see src/marketer/ugc/catalog.py), e.g. 'veo-3-1'.
    model_id      text not null,
    prompt        text not null default '',
    -- 'text_to_video' when no reference images were attached, else
    -- 'image_to_video' — the source's dual-mode switch, persisted so the
    -- UI can label a render without re-deriving it.
    render_mode   text not null default 'text_to_video'
                  check (render_mode in ('text_to_video', 'image_to_video')),

    -- Validated per-model settings. Empty string = the model has no such
    -- knob (Happy Horse / Seedance have no resolution or mode).
    aspect_ratio  text not null default '',
    resolution    text not null default '',
    mode          text not null default '',
    duration_sec  integer not null default 0,

    -- Reference image URLs in upload order; @image1 is element 0.
    image_urls    jsonb not null default '[]'::jsonb,

    provider            text not null default 'muapi',
    provider_request_id text,

    status        text not null default 'queued'
                  check (status in ('queued', 'running', 'done', 'failed')),
    video_url     text,
    error         text,
    -- What metering charged at submit time (spend_ledger is still the
    -- source of truth; this is denormalized for the render detail view).
    est_cost_usd  numeric(10,4) not null default 0,

    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create index if not exists ugc_renders_user_idx
    on ugc_renders (user_id, created_at desc);
create index if not exists ugc_renders_niche_idx
    on ugc_renders (niche_id) where niche_id is not null;
-- Webhook lookup key. Unique so a re-submitted request id can never
-- attach to two rows and complete the wrong user's render.
create unique index if not exists ugc_renders_request_idx
    on ugc_renders (provider_request_id) where provider_request_id is not null;
-- Reconciliation sweep: non-terminal rows that already have a request id.
create index if not exists ugc_renders_pending_idx
    on ugc_renders (status, updated_at) where status in ('queued', 'running');
