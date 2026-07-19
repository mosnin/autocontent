-- 0022: image posts (stills + carousels) and the template library.
--
-- image_posts: image-first content — one photo or a cohesive multi-slide
-- carousel (e.g. "5 diagrams explaining X"). Same tenancy/approval/spend
-- discipline as video jobs; slides live in the payload snapshot.
--
-- templates: admin-curated remixable references. Each carries the exact
-- prompt that produced its look; users remix with their own product
-- image and the generation inherits the aesthetic.

create table if not exists image_posts (
    id           uuid primary key default gen_random_uuid(),
    user_id      text not null references users(id) on delete cascade,
    niche_id     uuid not null references niches(id) on delete cascade,
    campaign_id  uuid references campaigns(id) on delete set null,
    -- 'single' | 'carousel'
    kind         text not null default 'carousel' check (kind in ('single','carousel')),
    topic        text not null default '',
    -- queued | planning | generating | awaiting_approval | scheduling | done | failed
    status       text not null default 'queued',
    payload      jsonb not null default '{}'::jsonb,
    provider_post_id text,
    error        text,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);
create index if not exists image_posts_user_idx on image_posts (user_id, created_at desc);
create index if not exists image_posts_campaign_idx on image_posts (campaign_id) where campaign_id is not null;

create table if not exists templates (
    id            uuid primary key default gen_random_uuid(),
    -- 'video' | 'image' | 'carousel'
    kind          text not null check (kind in ('video','image','carousel')),
    name          text not null,
    description   text not null default '',
    -- The exact prompt that produced the reference look; reused verbatim
    -- (plus the user's product image) on every remix.
    prompt        text not null,
    -- Library asset holding the reference image/video preview (admin's).
    reference_key text not null default '',
    config        jsonb not null default '{}'::jsonb,
    is_published  boolean not null default false,
    created_by    text not null references users(id) on delete cascade,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);
create index if not exists templates_published_idx on templates (is_published, kind);

-- Campaigns learn the image lane.
alter table campaign_items drop constraint if exists campaign_items_kind_check;
alter table campaign_items
    add constraint campaign_items_kind_check
    check (kind in ('video', 'article', 'ad', 'image'));

-- Attribution parity with jobs/articles.
create index if not exists image_posts_niche_idx on image_posts (niche_id);

-- Spend attribution for image posts (mirrors job_id/article_id).
alter table spend_ledger
    add column if not exists image_post_id uuid references image_posts(id) on delete set null;

-- Template remixes are niche-less spend; relax the ledger so they still
-- land in spend_ledger (global caps/billing see them; per-niche caps
-- don't apply to a null niche).
alter table spend_ledger alter column niche_id drop not null;
