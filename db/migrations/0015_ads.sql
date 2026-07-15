-- 0015: Ads product — connected ad accounts, campaigns, ad sets, creatives,
-- daily metrics, an append-only action/audit log, and spend-affecting
-- approvals.
--
-- Governance lives on ad_accounts (daily/monthly caps + kill-switch) and on
-- ad_campaigns (daily/lifetime budgets). Actual spend is read from
-- ad_metrics_daily; the AdSpendGuard sums it for pacing/cap checks. Every
-- spend-affecting action is written to ad_actions_log (append-only) and, above
-- a threshold, gated by an ad_approvals row.
--
-- Apply via the yoyo runner (marketer-migrate up).

-- Connected platform ad accounts (one row per user+platform+external account).
create table if not exists ad_accounts (
    id                  uuid primary key default gen_random_uuid(),
    user_id             text not null references users(id) on delete cascade,
    platform            text not null,   -- 'google_ads' | 'meta_ads' | 'linkedin_ads'
    external_account_id text not null default '',
    name                text not null default '',
    composio_connection_id text not null default '',
    status              text not null default 'pending',  -- pending|active|error|disconnected
    currency            text not null default 'USD',
    -- Governance: hard ceilings enforced fail-closed before any spend action.
    daily_cap_usd       numeric(12, 2),
    monthly_cap_usd     numeric(12, 2),
    killswitch          boolean not null default false,
    last_error          text not null default '',
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    unique (user_id, platform, external_account_id)
);
create index if not exists ad_accounts_user_idx on ad_accounts (user_id);

drop trigger if exists ad_accounts_updated_at on ad_accounts;
create trigger ad_accounts_updated_at before update on ad_accounts
    for each row execute function set_updated_at();

-- Campaigns.
create table if not exists ad_campaigns (
    id                  uuid primary key default gen_random_uuid(),
    user_id             text not null references users(id) on delete cascade,
    ad_account_id       uuid not null references ad_accounts(id) on delete cascade,
    external_campaign_id text not null default '',
    name                text not null default '',
    objective           text not null default '',
    status              text not null default 'draft',  -- draft|pending|active|paused|ended|failed
    daily_budget_usd    numeric(12, 2),
    lifetime_budget_usd numeric(12, 2),
    -- Optional link to the content source that seeded this campaign.
    niche_id            uuid references niches(id) on delete set null,
    last_error          text not null default '',
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);
create index if not exists ad_campaigns_user_idx on ad_campaigns (user_id);
create index if not exists ad_campaigns_account_idx on ad_campaigns (ad_account_id);

drop trigger if exists ad_campaigns_updated_at on ad_campaigns;
create trigger ad_campaigns_updated_at before update on ad_campaigns
    for each row execute function set_updated_at();

-- Ad sets / ad groups (targeting + bid live here on Meta; groups on Google).
create table if not exists ad_sets (
    id            uuid primary key default gen_random_uuid(),
    user_id       text not null references users(id) on delete cascade,
    campaign_id   uuid not null references ad_campaigns(id) on delete cascade,
    external_id   text not null default '',
    name          text not null default '',
    status        text not null default 'draft',
    targeting     jsonb not null default '{}'::jsonb,
    bid_usd       numeric(12, 2),
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);
create index if not exists ad_sets_campaign_idx on ad_sets (campaign_id);

drop trigger if exists ad_sets_updated_at on ad_sets;
create trigger ad_sets_updated_at before update on ad_sets
    for each row execute function set_updated_at();

-- Creatives — the bridge from our produced content (video jobs / articles) to
-- platform-native ad units.
create table if not exists ad_creatives (
    id                uuid primary key default gen_random_uuid(),
    user_id           text not null references users(id) on delete cascade,
    campaign_id       uuid references ad_campaigns(id) on delete cascade,
    external_id       text not null default '',
    kind              text not null default 'text',  -- image|video|text
    source_job_id     uuid references jobs(id) on delete set null,
    source_article_id uuid references articles(id) on delete set null,
    headline          text not null default '',
    body              text not null default '',
    media_path        text not null default '',
    cta               text not null default '',
    status            text not null default 'draft',
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);
create index if not exists ad_creatives_campaign_idx on ad_creatives (campaign_id);

drop trigger if exists ad_creatives_updated_at on ad_creatives;
create trigger ad_creatives_updated_at before update on ad_creatives
    for each row execute function set_updated_at();

-- Daily performance metrics (one row per campaign per day). The spend column
-- is the source of truth the guard sums for pacing/caps.
create table if not exists ad_metrics_daily (
    id            uuid primary key default gen_random_uuid(),
    user_id       text not null references users(id) on delete cascade,
    ad_account_id uuid not null references ad_accounts(id) on delete cascade,
    campaign_id   uuid not null references ad_campaigns(id) on delete cascade,
    date          date not null,
    impressions   bigint not null default 0,
    clicks        bigint not null default 0,
    spend_usd     numeric(12, 2) not null default 0,
    conversions   numeric(12, 2) not null default 0,
    revenue_usd   numeric(12, 2) not null default 0,
    created_at    timestamptz not null default now(),
    unique (campaign_id, date)
);
create index if not exists ad_metrics_account_date_idx on ad_metrics_daily (ad_account_id, date);
create index if not exists ad_metrics_user_date_idx on ad_metrics_daily (user_id, date);

-- Append-only audit log of every ads action (agent or human). Never updated.
create table if not exists ad_actions_log (
    id            bigint generated always as identity primary key,
    user_id       text not null,
    actor         text not null default 'agent',  -- 'agent' | 'user' | 'system'
    actor_email   text not null default '',
    action        text not null,     -- e.g. 'campaign.create', 'budget.increase'
    platform      text not null default '',
    target_type   text not null default '',
    target_id     text not null default '',
    dollar_delta_usd numeric(12, 2) not null default 0,
    before_json   jsonb,
    after_json    jsonb,
    ip            text,
    user_agent    text,
    created_at    timestamptz not null default now()
);
create index if not exists ad_actions_log_user_idx on ad_actions_log (user_id, created_at desc);
create index if not exists ad_actions_log_target_idx on ad_actions_log (target_type, target_id);

-- Approvals: spend-affecting actions above a threshold park here until a human
-- approves. The safe-execute layer refuses to run a gated action without an
-- approved row.
create table if not exists ad_approvals (
    id            uuid primary key default gen_random_uuid(),
    user_id       text not null references users(id) on delete cascade,
    ad_account_id uuid references ad_accounts(id) on delete cascade,
    campaign_id   uuid references ad_campaigns(id) on delete cascade,
    action        text not null,
    summary       text not null default '',
    dollar_delta_usd numeric(12, 2) not null default 0,
    payload_json  jsonb not null default '{}'::jsonb,
    status        text not null default 'pending',  -- pending|approved|rejected|expired|executed
    requested_by  text not null default 'agent',
    decided_by    text not null default '',
    decided_at    timestamptz,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);
create index if not exists ad_approvals_user_status_idx on ad_approvals (user_id, status);

drop trigger if exists ad_approvals_updated_at on ad_approvals;
create trigger ad_approvals_updated_at before update on ad_approvals
    for each row execute function set_updated_at();
