-- 0017: press planner — topic proposals (approval loop), publish targets,
-- article publish attempts, and the columns that let articles carry a
-- future publish date and a cached copy of their SERP research.
--
-- topic_proposals is the human-in-the-loop queue the autopilot scheduler
-- (marketer.services.scheduler.run_press_autopilot) drains: an operator (or
-- an LLM batch via POST /press/topics/generate) proposes topics, approves
-- or rejects them, and the scheduler consumes the oldest approved proposal
-- per below-cadence niche instead of picking blind via pick_topic.

create table if not exists topic_proposals (
    id            uuid primary key default gen_random_uuid(),
    user_id       text not null references users(id) on delete cascade,
    niche_id      uuid not null references niches(id) on delete cascade,
    title         text not null,
    focus_keyword text not null default '',
    rationale     text not null default '',
    score         numeric(4,3) not null default 0,
    status        text not null default 'pending'
                      check (status in ('pending', 'approved', 'rejected')),
    created_at    timestamptz not null default now(),
    decided_at    timestamptz
);

create index if not exists topic_proposals_user_idx on topic_proposals(user_id);
-- Both the approval-queue GET and the autopilot's "oldest approved" pick
-- filter by (niche_id, status) ordered by created_at, so a status-scoped
-- partial index covers both without carrying rejected/decided rows.
create index if not exists topic_proposals_pending_idx
    on topic_proposals(niche_id, created_at)
    where status = 'pending';
create index if not exists topic_proposals_approved_idx
    on topic_proposals(niche_id, created_at)
    where status = 'approved';

-- Publish targets: where a finished article can be pushed. `secret` holds
-- the WordPress application password or the webhook HMAC signing secret;
-- it is write-only from the API's perspective (POST accepts it, no GET
-- response ever echoes it back).
create table if not exists publish_targets (
    id         uuid primary key default gen_random_uuid(),
    user_id    text not null references users(id) on delete cascade,
    kind       text not null check (kind in ('wordpress', 'webhook')),
    name       text not null,
    base_url   text not null,
    username   text not null default '',
    secret     text not null default '',
    disabled   boolean not null default false,
    created_at timestamptz not null default now()
);

create index if not exists publish_targets_user_idx on publish_targets(user_id);

-- One row per publish attempt (manual or autopilot-triggered), so retries
-- and failures are auditable per article/target pair.
create table if not exists article_publishes (
    id           uuid primary key default gen_random_uuid(),
    article_id   uuid not null references articles(id) on delete cascade,
    target_id    uuid not null references publish_targets(id) on delete cascade,
    status       text not null default 'pending'
                     check (status in ('pending', 'ok', 'failed')),
    external_url text not null default '',
    error        text not null default '',
    created_at   timestamptz not null default now()
);

create index if not exists article_publishes_article_idx
    on article_publishes(article_id, created_at desc);
create index if not exists article_publishes_target_idx on article_publishes(target_id);

-- Articles: a future publish date (autopilot/manual scheduling) and a
-- cached copy of the pipeline's SERP research, so GET /articles/{id}/research
-- can serve it straight from the row instead of re-deriving it.
alter table articles add column if not exists scheduled_at timestamptz;
alter table articles add column if not exists serp_analysis jsonb;

create index if not exists articles_scheduled_idx on articles(user_id, scheduled_at)
    where scheduled_at is not null;

-- Niches: weekly article cadence target for the autopilot scheduler. 0
-- (the default) means autopilot is off for this niche even when the global
-- MARKETER_PRESS_AUTOPILOT_ENABLED switch is on — opt-in per niche.
alter table niches add column if not exists articles_per_week integer not null default 0;
