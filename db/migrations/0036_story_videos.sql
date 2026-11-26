-- 0036: story videos (docs/story-video.md).
--
-- A story video turns an idea or a script into a multi-shot film: script →
-- characters → storyboard (one first frame per shot, drawn against character
-- reference portraits) → shot clips → one assembled video. The stage design
-- is adapted from ViMax (MIT, see THIRD_PARTY_NOTICES.md).
--
-- story_videos      the editable plan (scenes, characters, shots) and status.
-- story_checkpoints one row per finished unit of work (a portrait, a frame, a
--                   clip, the final cut). A failed run resumes from these
--                   instead of starting again.
-- story_charges     every charge in integer micro-dollars under an
--                   idempotency key, unique per workspace: the same unit of
--                   work is never charged twice. The spend_ledger row (caps,
--                   credit) is written once, when the charge is new.

create table if not exists story_videos (
    id               uuid primary key default gen_random_uuid(),
    user_id          text not null references users(id) on delete cascade,
    niche_id         uuid references niches(id) on delete set null,
    created_by       text not null default '',
    title            text not null default '',
    mode             text not null check (mode in ('idea', 'script')),
    source           text not null,
    requirement      text not null default '',
    style            text not null default '',
    aspect           text not null default '9:16' check (aspect in ('9:16', '16:9', '1:1')),
    status           text not null default 'draft' check (status in (
                         'draft', 'writing', 'script_ready', 'boarding', 'storyboard_ready',
                         'awaiting_approval', 'rendering', 'done', 'failed')),
    stage            text not null default '',
    revision         integer not null default 0,
    plan             jsonb not null default '{}'::jsonb,
    estimate_micros  bigint not null default 0 check (estimate_micros >= 0),
    spent_micros     bigint not null default 0 check (spent_micros >= 0),
    approval_status  text check (approval_status in ('pending', 'approved', 'expired')),
    approval_args_hash text,
    approved_by      text,
    approved_at      timestamptz,
    video_path       text,
    error            text,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

create index if not exists story_videos_user_created_idx on story_videos(user_id, created_at desc);

create table if not exists story_checkpoints (
    story_id   uuid not null references story_videos(id) on delete cascade,
    key        text not null,
    artifact   jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    primary key (story_id, key)
);

create table if not exists story_charges (
    id              bigserial primary key,
    user_id         text not null references users(id) on delete cascade,
    story_id        uuid not null references story_videos(id) on delete cascade,
    idempotency_key text not null,
    stage           text not null,
    provider        text not null,
    sku             text not null,
    units           numeric not null default 0,
    cost_micros     bigint not null check (cost_micros >= 0),
    created_at      timestamptz not null default now(),
    unique (user_id, idempotency_key)
);

create index if not exists story_charges_story_idx on story_charges(story_id);
