-- 0018: Content Studio — media library.
--
-- media_assets is the durable, browsable record of every rendered asset:
-- pipeline output (source='pipeline', one row per finished job.rendered
-- video) and Content Studio edits (source='studio' — fal.ai image/video
-- tools). `path` is a location on the artifacts volume (job renders,
-- studio downloads); `url` is set instead when the asset is only
-- reachable remotely. Either may be blank but not both in practice.
--
-- Content Studio tools can run with no niche in scope at all (e.g.
-- touching up a stand-alone upload, or re-editing an old media asset), so
-- spend_ledger.niche_id — NOT NULL since 0001 — is loosened to nullable
-- here. Existing callers (video pipeline, article pipeline) always pass a
-- real niche_id, so this is purely additive.
--
-- Apply via the yoyo runner (marketer-migrate up).

create table if not exists media_assets (
    id           uuid primary key default gen_random_uuid(),
    user_id      text not null references users(id) on delete cascade,
    niche_id     uuid references niches(id) on delete set null,
    job_id       uuid references jobs(id) on delete set null,
    article_id   uuid references articles(id) on delete set null,
    kind         text not null check (kind in ('image', 'video', 'audio')),
    source       text not null check (source in ('pipeline', 'studio')),
    path         text not null default '',   -- volume-relative path on the artifacts volume
    url          text not null default '',   -- remote URL, when the asset isn't (or isn't only) on the volume
    mime         text not null default '',
    meta         jsonb not null default '{}'::jsonb,
    created_at   timestamptz not null default now(),
    deleted_at   timestamptz
);

create index if not exists media_assets_user_created_idx
    on media_assets(user_id, created_at desc);
create index if not exists media_assets_kind_idx on media_assets(kind);

-- Content Studio spend isn't always attributable to a niche.
alter table spend_ledger alter column niche_id drop not null;
