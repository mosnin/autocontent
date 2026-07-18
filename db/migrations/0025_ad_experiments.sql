-- 0025: Ads experiments — creative A/B tests and governed budget ramps
-- (Team Ads-Scale). Every experiment/arm row here is pure bookkeeping; the
-- actual spend-affecting mutations it drives (budget changes, pauses) flow
-- through the SAME safe-execute layer as everything else in Ads
-- (services/ad_actions_exec.py) — nothing in this schema authorizes spend on
-- its own.
--
-- Apply via the yoyo runner (marketer-migrate up).

create table if not exists ad_experiments (
    id            uuid primary key default gen_random_uuid(),
    user_id       text not null references users(id) on delete cascade,
    campaign_id   uuid not null references ad_campaigns(id) on delete cascade,
    kind          text not null check (kind in ('creative_ab', 'budget_ramp')),
    status        text not null default 'draft'
                      check (status in ('draft', 'running', 'completed', 'cancelled')),
    -- Kind-specific config, validated in services/ad_experiments.py before
    -- this row is written: creative_ids/window_days for creative_ab,
    -- target_daily_usd/step_pct/interval_days for budget_ramp.
    config        jsonb not null,
    -- Bookkeeping + outcome: rotation/attribution state for creative_ab,
    -- step history + pending-approval linkage for budget_ramp, winner info,
    -- safety-pause notes.
    result        jsonb not null default '{}'::jsonb,
    created_at    timestamptz not null default now(),
    started_at    timestamptz,
    completed_at  timestamptz
);
create index if not exists ad_experiments_user_idx on ad_experiments (user_id);
create index if not exists ad_experiments_campaign_idx on ad_experiments (campaign_id);

-- Arms only apply to creative_ab experiments (one per creative under test);
-- a budget_ramp experiment has none.
create table if not exists ad_experiment_arms (
    id            uuid primary key default gen_random_uuid(),
    experiment_id uuid not null references ad_experiments(id) on delete cascade,
    -- set null (not cascade-deleted) so a deleted creative doesn't erase the
    -- arm's accumulated metrics/winner history.
    creative_id   uuid references ad_creatives(id) on delete set null,
    label         text not null default '',
    metrics       jsonb not null default '{}'::jsonb,
    is_winner     boolean not null default false,
    created_at    timestamptz not null default now()
);
create index if not exists ad_experiment_arms_experiment_idx
    on ad_experiment_arms (experiment_id);
