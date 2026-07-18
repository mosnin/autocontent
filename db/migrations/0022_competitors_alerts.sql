-- 0022: competitor tracking + performance alerts (Team Competitors).
--
-- competitors: domains a user wants watched, optionally scoped to one
-- niche (used to compare a competitor's new posts against that niche's
-- focus areas). unique(user_id, domain) — a user can't double-track the
-- same domain.
--
-- competitor_articles: the diffed feed of pages `competitor_watch.run()`
-- has already seen for a competitor, keyed by URL so re-scans are a plain
-- "insert what's new" rather than delete+insert.
--
-- performance_alerts: the flat alert inbox both competitor_watch (kind=
-- competitor_activity) and alert_scan (kind in ranking_drop/cadence_slip/
-- quality_drop) write into. `context` carries kind-specific structured
-- detail (e.g. {"niche_id": ..., "competitor_domain": ..., "url": ...})
-- so the UI can deep-link without a second query; `acknowledged_at` is the
-- dedupe/dismiss marker (see alert_scan's dedupe: don't re-raise an
-- identical unacknowledged alert).
--
-- Apply via the yoyo runner (marketer-migrate up).

create table if not exists competitors (
    id         uuid primary key default gen_random_uuid(),
    user_id    text not null references users(id) on delete cascade,
    niche_id   uuid references niches(id) on delete set null,
    domain     text not null,
    label      text not null default '',
    created_at timestamptz not null default now(),
    unique (user_id, domain)
);

create index if not exists competitors_user_idx on competitors(user_id);
create index if not exists competitors_niche_idx on competitors(niche_id) where niche_id is not null;

create table if not exists competitor_articles (
    id              uuid primary key default gen_random_uuid(),
    competitor_id   uuid not null references competitors(id) on delete cascade,
    url             text not null,
    title           text not null default '',
    published_hint  text not null default '',
    first_seen      timestamptz not null default now(),
    unique (competitor_id, url)
);

-- competitor_watch's diff step ("which of these candidate URLs are new")
-- and GET /competitors/{id}/articles both filter/order by
-- (competitor_id, first_seen desc).
create index if not exists competitor_articles_competitor_idx
    on competitor_articles(competitor_id, first_seen desc);

create table if not exists performance_alerts (
    id              uuid primary key default gen_random_uuid(),
    user_id         text not null references users(id) on delete cascade,
    kind            text not null
                        check (kind in (
                            'ranking_drop', 'cadence_slip', 'quality_drop', 'competitor_activity'
                        )),
    severity        text not null default 'info'
                        check (severity in ('info', 'warn', 'critical')),
    message         text not null,
    context         jsonb not null default '{}',
    created_at      timestamptz not null default now(),
    acknowledged_at timestamptz
);

-- GET /alerts?acknowledged=false is the primary read path (inbox view);
-- the dedupe check in alert_scan/competitor_watch ("is there already an
-- identical unacknowledged alert of this kind") scans the same shape.
create index if not exists performance_alerts_user_created_idx
    on performance_alerts(user_id, created_at desc);
create index if not exists performance_alerts_unacked_idx
    on performance_alerts(user_id, kind) where acknowledged_at is null;
