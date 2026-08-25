-- 0027: SEO auditor results.
--
-- One row per completed audit of one URL. `result` holds the whole
-- AuditResult blob (categories, per-rule evidence, agent fix prompts) so the
-- detail view and the prompt download are single-row reads and never need to
-- re-scrape or re-score.
--
-- `cache_key` is sha256(schema_version || ':' || url), computed in Python
-- (marketer.seoaudit.audit.audit_cache_key). Bumping the schema version
-- retires the whole cache generation at once — old rows stay for history but
-- stop matching, so a result shape change can never be served as current.
-- Cache lookups are user-scoped: a stored audit is one tenant's artifact,
-- and serving another tenant's row would leak both the row id and when they
-- ran it.

create table if not exists seo_audits (
    id             uuid primary key default gen_random_uuid(),
    user_id        text not null references users(id) on delete cascade,
    -- Normalized audit URL (www stripped, host lowercased, no fragment).
    url            text not null,
    host           text not null,
    cache_key      text not null,
    schema_version text not null,
    -- 0-100, one decimal. numeric(4,1) tops out at 999.9 — plenty.
    score          numeric(4,1) not null,
    band           text not null,
    result         jsonb not null,
    created_at     timestamptz not null default now()
);

create index if not exists seo_audits_user_idx on seo_audits (user_id, created_at desc);
-- Serves the TTL cache read: newest row for this (user, key).
create index if not exists seo_audits_cache_idx
    on seo_audits (user_id, cache_key, created_at desc);
