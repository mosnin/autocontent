-- 0021: Campaigns — the orchestration product that pulls from Studio
-- (video content), Press (SEO articles), and Ads, and runs them together
-- against a time window and a content-credit budget.
--
-- campaign_items are lanes:
--   kind='video'   ref_id -> niches.id   (cadence_per_week videos, posted
--                                         to the niche's social platforms)
--   kind='article' ref_id -> niches.id   (cadence_per_week articles)
--   kind='ad'      ref_id -> ad_campaigns.id (linked; lifecycle goes
--                                         through the governed ads layer)
--
-- budget_usd caps CONTENT-GENERATION credit spend attributed to the
-- campaign (via jobs.campaign_id / articles.campaign_id -> spend_ledger).
-- Ad platform spend is governed separately by the fail-closed AdSpendGuard.

create table if not exists campaigns (
    id          uuid primary key default gen_random_uuid(),
    user_id     text not null references users(id) on delete cascade,
    name        text not null,
    objective   text not null default '',
    -- 'draft' | 'running' | 'paused' | 'completed'
    status      text not null default 'draft',
    starts_at   timestamptz not null default now(),
    ends_at     timestamptz,
    budget_usd  numeric(12, 2) not null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index if not exists campaigns_user_idx on campaigns (user_id, created_at desc);
create index if not exists campaigns_status_idx on campaigns (status);

create table if not exists campaign_items (
    id               uuid primary key default gen_random_uuid(),
    campaign_id      uuid not null references campaigns(id) on delete cascade,
    user_id          text not null references users(id) on delete cascade,
    -- 'video' | 'article' | 'ad'
    kind             text not null check (kind in ('video', 'article', 'ad')),
    ref_id           uuid not null,
    enabled          boolean not null default true,
    cadence_per_week integer not null default 3 check (cadence_per_week between 1 and 56),
    config           jsonb not null default '{}'::jsonb,
    created_at       timestamptz not null default now(),
    unique (campaign_id, kind, ref_id)
);
create index if not exists campaign_items_campaign_idx on campaign_items (campaign_id);

-- Attribution: work spawned by a campaign carries its id so spend rolls up.
alter table jobs add column if not exists campaign_id uuid references campaigns(id) on delete set null;
alter table articles add column if not exists campaign_id uuid references campaigns(id) on delete set null;
create index if not exists jobs_campaign_idx on jobs (campaign_id) where campaign_id is not null;
create index if not exists articles_campaign_idx on articles (campaign_id) where campaign_id is not null;
