-- 0033: motion graphics / kinetic typography projects.
--
-- One row = one narration driven to a composited vertical video whose
-- picture track changes on the narration's beats and whose type is burned
-- in on those same beats.
--
-- `beats`   : [{index, start, end, duration, text,
--               broll: {sourcing, camera_move, prompt, keyword,
--                       stock_query, stock_url, status, error, tags}}]
--             — the picture plan. `sourcing` records WHICH strategy
--             supplied the beat (generated keyframe vs. stock footage)
--             and the keyword/prompt it used, so a fallback is
--             explainable in the UI instead of just looking different.
-- `overlays`: [{text, start, end, animation, position, line, line_count,
--               beat_index}] — the kinetic type specs. Persisted rather
--             than recomputed so the detail view matches what was burned
--             even after a style's defaults change.
--
-- `job_id` (nullable) points at an existing video job whose voiceover and
-- transcript this project reuses instead of re-synthesizing. It is `on
-- delete set null`: losing the source job must not delete a finished
-- motion video, it just makes the reuse un-repeatable.
--
-- Spend attribution rides on niche_id (per-niche + global caps + prepaid
-- credit) exactly like the video, image and design lanes — TTS,
-- transcription, the batched keyword call and every keyframe are metered
-- through SpendContext with this project's niche, so no ledger column is
-- needed here.

create table if not exists motion_projects (
    id          uuid primary key default gen_random_uuid(),
    user_id     text not null references users(id) on delete cascade,
    niche_id    uuid not null references niches(id) on delete cascade,
    -- Reuse an existing job's voiceover + transcript instead of paying
    -- for TTS again. Null = synthesize from `narration`.
    job_id      uuid references jobs(id) on delete set null,
    narration   text not null default '',
    -- Style catalog key (marketer.motion.styles). Code, not a table:
    -- styles are product content that ships and versions with the app.
    style_key   text not null default 'modern-flat',
    aspect      text not null default '9:16'
                check (aspect in ('9:16', '16:9', '1:1')),
    -- Which b-roll sourcing strategy the project asked for. The per-beat
    -- record in `beats` is what actually happened (a stock beat can fall
    -- back to a generated one when a lookup misses).
    source      text not null default 'generated'
                check (source in ('generated', 'stock', 'mixed')),
    -- queued | voicing | transcribing | planning | rendering |
    -- compositing | done | failed
    status      text not null default 'queued',
    beats       jsonb not null default '[]'::jsonb,
    overlays    jsonb not null default '[]'::jsonb,
    video_path  text,
    error       text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    -- A project must have something to say: either its own narration or
    -- a job to borrow one from. Enforced here because the alternative is
    -- a row that can only ever fail after the worker starts.
    constraint motion_projects_has_narration
        check (job_id is not null or length(btrim(narration)) > 0)
);

-- The list endpoint is always "this user's projects, newest first",
-- optionally filtered by status.
create index if not exists motion_projects_user_idx
    on motion_projects (user_id, created_at desc);
create index if not exists motion_projects_niche_idx
    on motion_projects (niche_id);
-- The stale-project reaper scans non-terminal rows by last progress.
create index if not exists motion_projects_stale_idx
    on motion_projects (status, updated_at);
