-- 0035: Headshot / Portrait Studio.
--
-- One batch = one metered fan-out of N portrait variants rendered from
-- the user's own source photographs in one catalog style. The lane is
-- niche-optional (a founder portrait usually belongs to the account, not
-- to a channel), so niche_id is nullable exactly like ugc_renders.
--
-- Lifecycle:
--   batch:   queued -> running -> done | partial | failed
--   variant: queued -> running -> done | failed | cancelled
-- 'partial' exists because a batch is N independent charges: when a
-- provider error or a tripped spend cap stops variant 7 of 12, the six
-- already-paid-for portraits are real and must stay visible. 'cancelled'
-- distinguishes "we deliberately did not spend this" from "we tried and
-- it broke" — a cancelled variant was never charged.
--
-- PRIVACY NOTE: headshot_sources rows point at photographs of a real,
-- identifiable person. Every table here carries user_id and cascades
-- from users(id), so `privacy.erase_user` removes the metadata; the
-- bytes on the volume are removed by
-- `marketer.headshots.pipeline.purge_user_files`, which the account
-- erasure path calls before deleting the rows (the row is what tells us
-- which files to unlink). The user_id column is also what makes these
-- tables show up automatically in the GDPR data-portability export,
-- which discovers per-user tables from the catalog.

create table if not exists headshot_sources (
    id            uuid primary key default gen_random_uuid(),
    user_id       text not null references users(id) on delete cascade,
    -- Absolute path on the artifacts volume, under the user's partition.
    path          text not null,
    content_type  text not null default 'image/png',
    size_bytes    bigint not null default 0,
    -- Original client filename, for the picker only. Never used to build
    -- a path (that would be a traversal primitive).
    filename      text not null default '',
    created_at    timestamptz not null default now()
);
create index if not exists headshot_sources_user_idx
    on headshot_sources (user_id, created_at desc);

create table if not exists headshot_batches (
    id             uuid primary key default gen_random_uuid(),
    user_id        text not null references users(id) on delete cascade,
    -- Optional channel attribution; when set, that niche's daily spend
    -- cap gates the batch.
    niche_id       uuid references niches(id) on delete set null,

    -- Catalog key (see src/marketer/headshots/styles.py). Not an FK: the
    -- catalog is code, and a style retired from code must not orphan the
    -- historical batches that were rendered in it.
    style_key      text not null,
    subject_notes  text not null default '',
    variant_count  integer not null default 4
                   check (variant_count between 1 and 12),
    -- Ordered headshot_sources ids used as reference photos.
    source_image_ids jsonb not null default '[]'::jsonb,

    status         text not null default 'queued'
                   check (status in ('queued','running','done','partial','failed')),
    error          text,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);
create index if not exists headshot_batches_user_idx
    on headshot_batches (user_id, created_at desc);
create index if not exists headshot_batches_niche_idx
    on headshot_batches (niche_id) where niche_id is not null;
-- Reconciliation sweep for batches stranded by a dead container.
create index if not exists headshot_batches_pending_idx
    on headshot_batches (status, updated_at) where status in ('queued','running');

create table if not exists headshot_variants (
    id             uuid primary key default gen_random_uuid(),
    batch_id       uuid not null references headshot_batches(id) on delete cascade,
    -- Denormalized from the batch so every ownership check is a single
    -- predicate, and so the GDPR export/erasure crawler (which keys on a
    -- user_id column) reaches this table without a join.
    user_id        text not null references users(id) on delete cascade,
    variant_index  integer not null,
    status         text not null default 'queued'
                   check (status in ('queued','running','done','failed','cancelled')),
    image_path     text,
    error          text,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    unique (batch_id, variant_index)
);
create index if not exists headshot_variants_batch_idx
    on headshot_variants (batch_id, variant_index);
create index if not exists headshot_variants_user_idx
    on headshot_variants (user_id, created_at desc);
