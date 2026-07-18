-- 0019: Google Search Console — OAuth connection + synced search-analytics
-- rows.
--
-- gsc_connections is one row per user (unique on user_id): the refresh/
-- access token pair from the Google OAuth code flow plus the chosen GSC
-- property (site_url, picked via POST /site once the user has connected —
-- blank until then). access_token/token_expires_at are a cache the sync
-- job refreshes lazily; refresh_token is the durable credential.
--
-- gsc_daily is the hourly-synced Search Analytics rows (dimensions: date,
-- query, page), one row per (user_id, date, query, page) — the natural key
-- Google's API returns rows keyed by, so re-syncing overlapping days is a
-- plain upsert rather than a delete+insert.
--
-- Apply via the yoyo runner (marketer-migrate up).

create table if not exists gsc_connections (
    id                uuid primary key default gen_random_uuid(),
    user_id           text not null references users(id) on delete cascade,
    site_url          text not null default '',
    refresh_token     text not null default '',
    access_token      text not null default '',
    token_expires_at  timestamptz,
    connected_at      timestamptz not null default now(),
    unique (user_id)
);

create table if not exists gsc_daily (
    id           uuid primary key default gen_random_uuid(),
    user_id      text not null references users(id) on delete cascade,
    date         date not null,
    query        text not null default '',
    page         text not null default '',
    clicks       integer not null default 0,
    impressions  integer not null default 0,
    ctr          numeric(7,4) not null default 0,
    position     numeric(6,2) not null default 0,
    unique (user_id, date, query, page)
);

-- /rankings and /gaps both window by (user_id, date) ordered most-recent
-- first; the sync job's "last 3 days" pull also scans by this shape.
create index if not exists gsc_daily_user_date_idx on gsc_daily(user_id, date desc);
-- /queries?page= and the gaps join group/filter by query within a user.
create index if not exists gsc_daily_user_query_idx on gsc_daily(user_id, query);
-- /queries?page= filters by page within a user.
create index if not exists gsc_daily_user_page_idx on gsc_daily(user_id, page);
