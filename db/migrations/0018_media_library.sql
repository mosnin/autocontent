-- 0018: media library — durable index of every produced media artifact
-- (scene clips, keyframes, voiceovers, final videos) plus "compositions":
-- new videos remixed from existing clips.
--
-- `storage` records where the bytes live: 'wasabi' (S3 object storage,
-- object_key set) or 'volume' (Modal artifacts volume, object_key is the
-- volume-relative path). The library UI reads this table; playback URLs
-- are presigned for wasabi rows and streamed from the API for volume rows.
--
-- Apply via the yoyo runner (marketer-migrate up).

create table if not exists media_assets (
    id            uuid primary key default gen_random_uuid(),
    user_id       text not null references users(id) on delete cascade,
    niche_id      uuid references niches(id) on delete set null,
    job_id        uuid references jobs(id) on delete set null,
    -- 'clip' | 'keyframe' | 'voiceover' | 'final' | 'composition'
    kind          text not null,
    scene_index   integer,
    -- 'wasabi' | 'volume'
    storage       text not null,
    object_key    text not null,
    content_type  text not null default 'video/mp4',
    size_bytes    bigint not null default 0,
    duration_sec  numeric(8, 2),
    -- denormalized context so the library renders without joins
    title         text not null default '',
    created_at    timestamptz not null default now(),
    unique (user_id, storage, object_key)
);
create index if not exists media_assets_user_kind_idx
    on media_assets (user_id, kind, created_at desc);
create index if not exists media_assets_user_niche_idx
    on media_assets (user_id, niche_id, created_at desc);
create index if not exists media_assets_job_idx on media_assets (job_id);

create table if not exists compositions (
    id               uuid primary key default gen_random_uuid(),
    user_id          text not null references users(id) on delete cascade,
    title            text not null default '',
    -- ordered list of media_assets.id (clips) to concatenate
    clip_asset_ids   jsonb not null,
    -- 'keep' (clip audio passes through) | 'mute' (silent concat)
    audio_mode       text not null default 'keep',
    -- 'queued' | 'rendering' | 'done' | 'failed'
    status           text not null default 'queued',
    output_asset_id  uuid references media_assets(id) on delete set null,
    error            text,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);
create index if not exists compositions_user_idx
    on compositions (user_id, created_at desc);
