-- 0026: Studio generations — the server-side record of every generation
-- started from a Studio surface (image, video, audio, lip sync, cinema,
-- recast, …).
--
-- Why a table at all: the reference implementation the Studio UI is
-- ported from ran generation straight from the browser and kept history
-- in localStorage. Ours runs server-side through the provider layer, so
-- the row IS the job: it carries the request the user made, the provider
-- we routed it to, the provider's request id (for support/forensics),
-- the resulting outputs, and what it cost. History survives a device
-- change because it lives here, scoped to user_id, and the spend it
-- caused is joinable through spend_ledger.studio_generation_id.
--
-- `params` is the request as submitted (prompt, aspect ratio, reference
-- URLs, …) after validation, so a generation can be reproduced and
-- audited. `outputs` is a jsonb array of
-- {url, kind, content_type, asset_id} objects.
--
-- Apply via the yoyo runner (marketer-migrate up).

create table if not exists studio_generations (
    id                  uuid primary key default gen_random_uuid(),
    user_id             text not null references users(id) on delete cascade,
    -- 'image' | 'video' | 'audio' | 'lipsync' | 'video2video' | 'recast'
    kind                text not null,
    -- Catalog model id (a real vendor/provider model identifier).
    model               text not null,
    params              jsonb not null default '{}'::jsonb,
    -- 'queued' | 'running' | 'done' | 'failed'
    status              text not null default 'queued'
                        check (status in ('queued','running','done','failed')),
    -- Which of our provider implementations ran it: 'fal' | 'openai' |
    -- 'xai' | 'elevenlabs'. Null until the router has resolved it.
    provider            text,
    -- The provider's own request/job id, for correlating with their logs.
    provider_request_id text,
    outputs             jsonb not null default '[]'::jsonb,
    error               text,
    cost_usd            numeric(12, 6) not null default 0,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

-- History panel: newest-first per user, keyset-paginated on
-- (created_at, id) so a cursor is stable across inserts.
create index if not exists studio_generations_user_created_idx
    on studio_generations (user_id, created_at desc, id desc);

-- History panel filtered to one studio (kind tab).
create index if not exists studio_generations_user_kind_idx
    on studio_generations (user_id, kind, created_at desc, id desc);

-- Reaper / ops: find non-terminal rows without scanning the table.
create index if not exists studio_generations_pending_idx
    on studio_generations (status, updated_at)
    where status in ('queued', 'running');

-- Spend attribution for studio generations, mirroring job_id /
-- article_id / image_post_id. Studio spend is niche-less: global caps
-- and prepaid credit apply, per-niche caps do not (niche_id is already
-- nullable as of 0022).
alter table spend_ledger
    add column if not exists studio_generation_id uuid
    references studio_generations(id) on delete set null;

create index if not exists spend_ledger_studio_generation_idx
    on spend_ledger (studio_generation_id)
    where studio_generation_id is not null;
