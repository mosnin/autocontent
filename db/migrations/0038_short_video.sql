-- 0038: short video (docs/short-video.md).
--
-- A batch is one request: a topic or a script, the look/footage/subtitle/music
-- settings, and 1 to 10 variants. Each variant is an item that walks its own
-- stages. Large batches wait in 'awaiting_approval' for a person.
--
-- short_video_charges is the per-call money ledger: one row per paid provider
-- call, keyed by an idempotency key claimed BEFORE the call, cost in integer
-- micro-dollars. spend_ledger still receives the same spend through
-- SpendContext, so the playbook, global and prepaid-credit caps apply.
--
-- short_video_uploads are the person's own images and videos, validated before
-- use. stock_footage_cache keeps provider search results for 24 hours.

create table if not exists short_video_batches (
    id               uuid primary key default gen_random_uuid(),
    user_id          text not null references users(id) on delete cascade,
    niche_id         uuid references niches(id) on delete set null,
    created_by       text not null default '',
    principal        text not null default 'user',
    title            text not null default '',
    source           text not null check (source in ('topic', 'script')),
    topic            text not null default '',
    script           text not null default '',
    settings         jsonb not null,
    variants         integer not null check (variants between 1 and 10),
    status           text not null check (status in
                       ('awaiting_approval', 'queued', 'running', 'done', 'partial', 'failed', 'cancelled')),
    estimate_micros  bigint not null default 0 check (estimate_micros >= 0),
    cap_micros       bigint not null check (cap_micros > 0),
    args_hash        text not null,
    approved_by      text,
    approved_at      timestamptz,
    error            text,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);
create index if not exists short_video_batches_user_idx
    on short_video_batches (user_id, created_at desc);

create table if not exists short_video_items (
    id               uuid primary key default gen_random_uuid(),
    batch_id         uuid not null references short_video_batches(id) on delete cascade,
    user_id          text not null references users(id) on delete cascade,
    variant          integer not null,
    attempt          integer not null default 1,
    status           text not null default 'queued' check (status in
                       ('queued', 'running', 'done', 'failed', 'cancelled')),
    stage            text not null default 'queued',
    progress         integer not null default 0 check (progress between 0 and 100),
    stages           jsonb not null default '{}'::jsonb,
    hook             text not null default '',
    script           text not null default '',
    search_terms     jsonb not null default '[]'::jsonb,
    clips            jsonb not null default '[]'::jsonb,
    output_asset_id  uuid references media_assets(id) on delete set null,
    video_path       text,
    srt_path         text,
    vtt_path         text,
    duration_sec     numeric(8, 2),
    error            text,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    unique (batch_id, variant)
);
create index if not exists short_video_items_batch_idx on short_video_items (batch_id, variant);

create table if not exists short_video_charges (
    idempotency_key  text primary key,
    user_id          text not null references users(id) on delete cascade,
    batch_id         uuid references short_video_batches(id) on delete cascade,
    item_id          uuid references short_video_items(id) on delete cascade,
    stage            text not null,
    provider         text not null,
    sku              text not null default '',
    status           text not null default 'pending' check (status in ('pending', 'done', 'failed')),
    cost_micros      bigint not null default 0 check (cost_micros >= 0),
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);
create index if not exists short_video_charges_batch_idx on short_video_charges (batch_id);
create index if not exists short_video_charges_item_idx on short_video_charges (item_id);

create table if not exists short_video_uploads (
    id               uuid primary key default gen_random_uuid(),
    user_id          text not null references users(id) on delete cascade,
    kind             text not null check (kind in ('video', 'image')),
    filename         text not null default '',
    content_type     text not null,
    size_bytes       bigint not null check (size_bytes > 0),
    status           text not null default 'pending' check (status in ('pending', 'ready', 'rejected')),
    storage          text not null default 'wasabi',
    object_key       text not null,
    width            integer,
    height           integer,
    duration_sec     numeric(8, 2),
    error            text,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    unique (user_id, object_key)
);
create index if not exists short_video_uploads_user_idx
    on short_video_uploads (user_id, created_at desc);

create table if not exists stock_footage_cache (
    provider     text not null,
    query        text not null,
    orientation  text not null,
    results      jsonb not null,
    fetched_at   timestamptz not null default now(),
    primary key (provider, query, orientation)
);
