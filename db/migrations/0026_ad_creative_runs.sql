-- 0026: Ad Creative Studio — one public domain in, a bounded Ad Run of
-- on-brand 1:1 ad images out.
--
-- ad_creative_runs: one research + planning pass over a Brand domain.
-- `brief` holds the whole normalized Brief (brand facts, the extracted
-- palette as hex, the two prompt color phrases, the logo URL) so the
-- Gallery can show what the plan was built from and a slot retry can
-- re-render without re-researching — the expensive part is the vendor
-- calls, not the row.
--
-- ad_creative_slots: the rendering lifecycle and result of one Planned
-- Concept. Each carries its own Creative Direction and Image Model,
-- which the run contract requires to be distinct across the run; the
-- unique index on (run_id, position) keeps the company-then-product
-- ordering intact. `image_path` points at the Modal artifacts volume,
-- which is what the image endpoint streams.

create table if not exists ad_creative_runs (
    id          uuid primary key default gen_random_uuid(),
    user_id     text not null references users(id) on delete cascade,
    -- Optional: attributes the run's spend to a niche's daily cap.
    niche_id    uuid references niches(id) on delete set null,
    domain      text not null,
    brand_name  text not null default '',
    -- queued | planning | rendering | done | failed
    status      text not null default 'queued'
                check (status in ('queued','planning','rendering','done','failed')),
    brief       jsonb not null default '{}'::jsonb,
    error       text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index if not exists ad_creative_runs_user_idx
    on ad_creative_runs (user_id, created_at desc);
create index if not exists ad_creative_runs_niche_idx
    on ad_creative_runs (niche_id) where niche_id is not null;

create table if not exists ad_creative_slots (
    id                  uuid primary key default gen_random_uuid(),
    run_id              uuid not null references ad_creative_runs(id) on delete cascade,
    -- Denormalized owner so every slot read is user-scoped without a
    -- join: the image endpoint is a public URL guarded only by this.
    user_id             text not null references users(id) on delete cascade,
    position            int not null,
    direction_key       text not null,
    image_model_id      text not null,
    subject_kind        text not null check (subject_kind in ('company','product')),
    product_name        text not null default '',
    product_description text not null default '',
    headline            text not null default '',
    subheadline         text not null default '',
    -- queued | rendering | done | failed
    status              text not null default 'queued'
                        check (status in ('queued','rendering','done','failed')),
    image_path          text,
    error               text,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);
create unique index if not exists ad_creative_slots_position_idx
    on ad_creative_slots (run_id, position);
create index if not exists ad_creative_slots_user_idx
    on ad_creative_slots (user_id, created_at desc);
