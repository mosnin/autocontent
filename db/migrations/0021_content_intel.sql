-- 0021: content intelligence — topic clusters, corpus audit, and
-- cannibalization detection (Team Content-Intel).
--
-- content_clusters / content_cluster_items back POST /intelligence/clusters/plan
-- (one metered LLM call builds a pillar + spoke plan; spokes already
-- covered by an existing article are marked 'covered' up front, the rest
-- start 'proposed' until promoted into the press topic_proposals queue).
--
-- article_audits is a point-in-time snapshot per article (NO LLM — scored
-- from stored data: quality jsonb, age, hero image, meta description,
-- internal link suggestion count). Multiple rows can accumulate per
-- article; callers wanting the current state take the latest by
-- created_at (see repos/content_intel.py:latest_audits).
--
-- cannibalization_findings is a similarity scan (NO LLM — difflib
-- SequenceMatcher over titles + focus keywords) over the user's own
-- corpus. Re-scanning upserts on the (user_id, article_a, article_b) pair
-- so a finding's `resolution` note survives a re-scan.

create table if not exists content_clusters (
    id             uuid primary key default gen_random_uuid(),
    user_id        text not null references users(id) on delete cascade,
    niche_id       uuid not null references niches(id) on delete cascade,
    title          text not null default '',
    pillar_keyword text not null default '',
    description    text not null default '',
    created_at     timestamptz not null default now()
);

create index if not exists content_clusters_user_idx
    on content_clusters(user_id, created_at desc);
create index if not exists content_clusters_niche_idx
    on content_clusters(niche_id);

-- Surrogate `id` (rather than a composite key on cluster_id) because items
-- start with no article_id (proposed spokes) and article_id is nullable —
-- a composite primary key can't rely on a nullable column.
create table if not exists content_cluster_items (
    id             uuid primary key default gen_random_uuid(),
    cluster_id     uuid not null references content_clusters(id) on delete cascade,
    article_id     uuid references articles(id) on delete set null,
    proposed_title text not null default '',
    focus_keyword  text not null default '',
    status         text not null default 'proposed'
                       check (status in ('proposed', 'covered'))
);

create index if not exists content_cluster_items_cluster_idx
    on content_cluster_items(cluster_id);
create index if not exists content_cluster_items_article_idx
    on content_cluster_items(article_id) where article_id is not null;

create table if not exists article_audits (
    id         uuid primary key default gen_random_uuid(),
    user_id    text not null references users(id) on delete cascade,
    article_id uuid not null references articles(id) on delete cascade,
    score      numeric(5,2) not null,
    findings   jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists article_audits_user_idx
    on article_audits(user_id, created_at desc);
-- Latest-per-article lookups (GET /intelligence/audit) select distinct on
-- article_id ordered by created_at desc — this index covers that scan.
create index if not exists article_audits_article_idx
    on article_audits(article_id, created_at desc);

create table if not exists cannibalization_findings (
    id         uuid primary key default gen_random_uuid(),
    user_id    text not null references users(id) on delete cascade,
    article_a  uuid not null references articles(id) on delete cascade,
    article_b  uuid not null references articles(id) on delete cascade,
    keyword    text not null default '',
    similarity numeric(5,4) not null,
    resolution text not null default '',
    created_at timestamptz not null default now(),
    unique (user_id, article_a, article_b)
);

create index if not exists cannibalization_findings_user_idx
    on cannibalization_findings(user_id, similarity desc);
