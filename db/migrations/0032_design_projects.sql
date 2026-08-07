-- 0032: the Design Agent — brief -> plan -> canvas.
--
-- A design project is one creative brief driven autonomously to a set of
-- images. Unlike image_posts (which one-shots N cohesive slides), a
-- design project first produces an explicit, inspectable PLAN: a DAG of
-- concrete canvas operations (generate / edit / compose / upscale /
-- text_overlay) where later steps consume the *output image* of earlier
-- ones. That plan is the row's `plan` jsonb, rewritten after every
-- executed layer so the plan view streams progress and a retry can
-- resume from the steps that already succeeded.
--
-- `plan`  : {title, format, notes, steps: [{index, id, operation, inputs,
--            depends_on, status, error, output_path, output_digest}]}
-- `canvas`: [{step_id, index, operation, label, path, digest, size, bytes}]
--           — the produced objects, content-addressed on the Modal volume.
--
-- Spend attribution rides on niche_id (per-niche + global caps + prepaid
-- credit) exactly like the video and image lanes; no new ledger column is
-- needed because planning and every render are metered through
-- SpendContext with this project's niche.

create table if not exists design_projects (
    id          uuid primary key default gen_random_uuid(),
    user_id     text not null references users(id) on delete cascade,
    niche_id    uuid not null references niches(id) on delete cascade,
    -- The natural-language design brief the planner turns into steps.
    brief       text not null default '',
    -- Aspect ratio; maps to the priced gpt-image-1 sizes.
    format      text not null default '1:1'
                check (format in ('1:1', '9:16', '16:9')),
    -- Per-request cap on plan length. The application clamps this to its
    -- own hard ceiling too — an LLM-authored plan is untrusted input and
    -- every step is a paid image call.
    max_steps   integer not null default 8 check (max_steps between 1 and 16),
    -- queued | planning | executing | done | failed
    status      text not null default 'queued',
    plan        jsonb not null default '{}'::jsonb,
    canvas      jsonb not null default '[]'::jsonb,
    error       text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- The list endpoint is always "this user's projects, newest first",
-- optionally filtered by status.
create index if not exists design_projects_user_idx
    on design_projects (user_id, created_at desc);
create index if not exists design_projects_niche_idx
    on design_projects (niche_id);
-- The stale-project reaper scans non-terminal rows by last progress.
create index if not exists design_projects_stale_idx
    on design_projects (status, updated_at);
