-- 0001_init.sql — initial multi-tenant schema for autocontent.
--
-- Identity is owned by Clerk. We store the Clerk user id as the PK and
-- denormalize email for display. All tenant-owned rows reference users(id).
--
-- Apply with:
--   psql "$SUPABASE_DB_URL" -f db/migrations/0001_init.sql

create extension if not exists pgcrypto;

create table if not exists users (
    id              text primary key,                -- Clerk user_id
    email           text not null,
    created_at      timestamptz not null default now(),
    ayrshare_profile_key text                        -- per-user Ayrshare profile
);

create table if not exists niches (
    id              uuid primary key default gen_random_uuid(),
    user_id         text not null references users(id) on delete cascade,
    title           text not null,
    description     text not null,
    target_audience text not null,
    hashtags        text[] not null default '{}',

    -- generation prefs (no defaults — onboarding must collect)
    visual_style    text not null,                   -- e.g. "soft 3D claymation, pastel..."
    voice           text not null,                   -- OpenAI TTS voice id
    target_duration_sec  int  not null,              -- scriptwriter target
    scene_count     int  not null,

    -- scheduling
    posting_windows jsonb not null,                  -- [{"hour":9,"minute":0,"tz":"America/Los_Angeles"}, ...]
    platforms       text[] not null,                 -- {"tiktok","reels","shorts"}

    -- spend guardrail
    daily_spend_cap_usd  numeric(8,2) not null,

    created_at      timestamptz not null default now(),
    archived_at     timestamptz
);

create index if not exists niches_user_idx on niches(user_id) where archived_at is null;

create type job_status as enum (
    'queued','ideating','scripting','generating_images','animating',
    'voicing','editing','captioning','qa','scheduling','done','failed'
);

create table if not exists jobs (
    id              uuid primary key default gen_random_uuid(),
    user_id         text not null references users(id) on delete cascade,
    niche_id        uuid not null references niches(id) on delete cascade,
    status          job_status not null default 'queued',
    platform        text not null,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    scheduled_for   timestamptz,
    error           text,
    -- full Job snapshot (script, clips, paths) — pipeline writes here on each stage
    payload         jsonb not null default '{}'::jsonb
);

create index if not exists jobs_user_status_idx on jobs(user_id, status);
create index if not exists jobs_niche_created_idx on jobs(niche_id, created_at desc);

-- Every credit-spending action lands here. Cap check sums today's rows for a niche.
create table if not exists spend_ledger (
    id              bigserial primary key,
    user_id         text not null references users(id) on delete cascade,
    niche_id        uuid not null references niches(id) on delete cascade,
    job_id          uuid references jobs(id) on delete set null,
    provider        text not null,                   -- 'openai','xai','ayrshare'
    sku             text not null,                   -- 'dalle3','grok-imagine','tts-1-hd','whisper-1', ...
    units           numeric(12,4) not null,          -- images, seconds, characters
    cost_usd        numeric(10,4) not null,
    created_at      timestamptz not null default now()
);

create index if not exists spend_user_niche_day_idx
    on spend_ledger(user_id, niche_id, (cast(created_at at time zone 'UTC' as date)));

-- Updated-at trigger for jobs.
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists jobs_updated_at on jobs;
create trigger jobs_updated_at before update on jobs
    for each row execute function set_updated_at();
