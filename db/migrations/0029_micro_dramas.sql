-- 0029: micro-dramas — multi-shot vertical shorts with a recurring cast.
--
-- The third content type next to video jobs and articles. What makes it its
-- own table rather than a job variant: a drama is built from a SCREENPLAY
-- (title/logline/beats/shot list) and a CAST whose reference portraits are
-- locked once and reused for every shot. Neither concept fits the video
-- job_status enum or the Job snapshot shape.
--
-- `plan` is the resume checkpoint: the DramaPlan snapshot (screenplay, cast
-- with locked portrait paths, shots with keyframe/clip paths) is rewritten
-- after every stage. A retry reads it and re-buys nothing that already
-- succeeded — which matters more here than anywhere else in the product,
-- since a drama costs one image AND one video generation per shot.
--
-- Status is a plain text column (not an enum) so adding a stage later is a
-- code change, not a migration: queued | screenwriting | casting |
-- storyboarding | rendering | editing | done | failed.

create table if not exists micro_dramas (
    id           uuid primary key default gen_random_uuid(),
    user_id      text not null references users(id) on delete cascade,
    niche_id     uuid not null references niches(id) on delete cascade,
    status       text not null default 'queued',
    -- Exactly one of these is used. A non-empty `script` skips the
    -- screenwriter stage (and its spend) entirely.
    idea         text not null default '',
    script       text not null default '',
    -- Hard-bounded in the API and again in code: a drama's shot count is the
    -- multiplier on its total provider spend.
    shot_count   integer not null default 6
                 check (shot_count between 2 and 12),
    aspect       text not null default '9:16'
                 check (aspect in ('9:16', '16:9', '1:1')),
    plan         jsonb not null default '{}'::jsonb,
    video_path   text,
    duration_sec double precision,
    error        text,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

-- The list endpoint is always "my dramas, newest first", optionally filtered
-- by status.
create index if not exists micro_dramas_user_created_idx
    on micro_dramas (user_id, created_at desc);
create index if not exists micro_dramas_user_status_idx
    on micro_dramas (user_id, status);
-- Attribution parity with jobs/articles/image_posts.
create index if not exists micro_dramas_niche_idx on micro_dramas (niche_id);
-- The stale reaper scans non-terminal rows by last progress.
create index if not exists micro_dramas_stale_idx
    on micro_dramas (updated_at)
    where status not in ('done', 'failed');

drop trigger if exists micro_dramas_updated_at on micro_dramas;
create trigger micro_dramas_updated_at before update on micro_dramas
    for each row execute function set_updated_at();
