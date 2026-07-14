-- 0010: written-content / SEO pipeline.
--
-- Articles are the second content type next to video jobs: SERP-researched,
-- SEO-optimized long-form posts. They carry their own status lifecycle
-- (the job_status enum is video-stage-specific) and attribute spend via a
-- new nullable spend_ledger.article_id.

create type article_status as enum (
    'queued', 'researching', 'outlining', 'writing', 'qa',
    'metadata', 'imaging', 'done', 'failed'
);

create table if not exists articles (
    id               uuid primary key default gen_random_uuid(),
    user_id          text not null references users(id) on delete cascade,
    niche_id         uuid not null references niches(id) on delete cascade,
    status           article_status not null default 'queued',
    topic            text not null default '',
    focus_keyword    text not null default '',
    title            text,
    slug             text,
    meta_description text,
    keywords         text[] not null default '{}',
    article_markdown text,
    schema_json      text,               -- JSON-LD string (Article + FAQPage @graph)
    hero_image_path  text,
    hero_image_alt   text,
    quality          jsonb,              -- QualityScore snapshot
    link_suggestions jsonb not null default '[]'::jsonb,
    word_count       integer,
    error            text,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

create index if not exists articles_user_status_idx on articles(user_id, status);
create index if not exists articles_niche_created_idx on articles(niche_id, created_at desc);
-- Interlink suggestions look up prior finished articles by slug.
create index if not exists articles_user_slug_idx on articles(user_id, slug)
    where slug is not null;

drop trigger if exists articles_updated_at on articles;
create trigger articles_updated_at before update on articles
    for each row execute function set_updated_at();

-- Spend attribution for article runs (job_id stays null for these rows).
alter table spend_ledger
    add column if not exists article_id uuid references articles(id) on delete set null;

create index if not exists spend_ledger_article_idx on spend_ledger(article_id)
    where article_id is not null;
