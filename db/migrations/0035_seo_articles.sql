-- 0035: SEO articles (docs/seo-articles.md).
--
-- articles gains:
--   research          web research with cited sources (untrusted content,
--                     sanitized before it is stored; never instructions)
--   meta_title        the SEO title (<= 60), separate from the H1 title
--   cover_image       Unsplash photo + attribution, shown wherever the cover is
--   publish_*         WordPress publishing state; publish_at is when a live
--                     post goes out (the calendar drags this), publish_args_hash
--                     binds a scheduled publish to the exact article it was
--                     scheduled with (docs/rails/approvals.md)
--   batch_id          the bulk batch that created the article, if any
--
-- wordpress_connections: one per workspace. The application password is
-- sealed (services/secret_box.py) and never returned by any route.
--
-- article_batches / article_batch_items: bulk generation from a keyword list,
-- one row per keyword with its own status. Items wait ('queued', with
-- held_reason='spend_cap') rather than fail when a cap is reached.

alter table articles add column if not exists research jsonb;
alter table articles add column if not exists meta_title text;
alter table articles add column if not exists cover_image jsonb;
alter table articles add column if not exists publish_status text not null default 'none'
    check (publish_status in ('none', 'scheduled', 'publishing', 'published', 'failed', 'unknown', 'needs_review'));
alter table articles add column if not exists publish_mode text
    check (publish_mode is null or publish_mode in ('draft', 'live'));
alter table articles add column if not exists publish_at timestamptz;
alter table articles add column if not exists publish_args_hash text;
alter table articles add column if not exists publish_error text;
alter table articles add column if not exists wp_post_id bigint;
alter table articles add column if not exists wp_post_url text;
alter table articles add column if not exists published_at timestamptz;
alter table articles add column if not exists batch_id uuid;

create index if not exists articles_publish_due_idx on articles (publish_at)
    where publish_status = 'scheduled';

create table if not exists wordpress_connections (
    id               uuid primary key default gen_random_uuid(),
    user_id          text not null unique references users(id) on delete cascade,
    site_url         text not null check (site_url like 'https://%' and length(site_url) <= 300),
    username         text not null check (length(username) between 1 and 120),
    password_sealed  text not null check (password_sealed like 'v1:%'),
    seo_plugin       text not null default 'yoast' check (seo_plugin in ('yoast', 'rankmath', 'none')),
    status           text not null default 'active' check (status in ('active', 'error')),
    last_error       text not null default '',
    verified_at      timestamptz,
    created_by       text not null default '',
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

drop trigger if exists wordpress_connections_updated_at on wordpress_connections;
create trigger wordpress_connections_updated_at before update on wordpress_connections
    for each row execute function set_updated_at();

create table if not exists article_batches (
    id          uuid primary key default gen_random_uuid(),
    user_id     text not null references users(id) on delete cascade,
    niche_id    uuid not null references niches(id) on delete cascade,
    created_by  text not null default '',
    status      text not null default 'running' check (status in ('running', 'paused_cap', 'done', 'cancelled')),
    total       integer not null check (total between 1 and 200),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index if not exists article_batches_user_idx on article_batches (user_id, created_at desc);

drop trigger if exists article_batches_updated_at on article_batches;
create trigger article_batches_updated_at before update on article_batches
    for each row execute function set_updated_at();

create table if not exists article_batch_items (
    id           uuid primary key default gen_random_uuid(),
    batch_id     uuid not null references article_batches(id) on delete cascade,
    user_id      text not null references users(id) on delete cascade,
    position     integer not null,
    keyword      text not null check (length(keyword) between 1 and 200),
    status       text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
    held_reason  text,
    article_id   uuid references articles(id) on delete set null,
    error        text,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (batch_id, position)
);
create index if not exists article_batch_items_batch_idx on article_batch_items (batch_id, position);
create index if not exists article_batch_items_open_idx on article_batch_items (status)
    where status in ('queued', 'running');

drop trigger if exists article_batch_items_updated_at on article_batch_items;
create trigger article_batch_items_updated_at before update on article_batch_items
    for each row execute function set_updated_at();

alter table articles drop constraint if exists articles_batch_id_fkey;
alter table articles add constraint articles_batch_id_fkey
    foreign key (batch_id) references article_batches(id) on delete set null;
