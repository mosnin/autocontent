-- 0031: the scheduled-post queue (hand-authored posts on a calendar).
--
-- Three tables, derived one-for-one from every statement in
-- src/marketer/repos/scheduled_posts.py:
--
--   recurring_slots           weekday + local wall-clock templates
--   scheduled_posts          the calendar item (copy, media, ONE utc instant)
--   scheduled_post_variants  one row per target platform, each with its OWN
--                            delivery status
--
-- Why the fan-out is a separate table rather than a jsonb array on the
-- parent: delivery state is per platform. Instagram can fail while TikTok
-- succeeds, and the retry must re-send only Instagram. That is only
-- expressible if each destination is a row we can claim with an atomic
-- WHERE-status UPDATE (see `claim_variant`). A jsonb array would force a
-- read-modify-write of the whole array, which is exactly the race that
-- double-posts to a real social account.
--
-- Why `scheduled_at` is timestamptz and `timezone` is a separate text
-- column: the instant is what the dispatcher compares (`scheduled_at <=
-- now()`), so it must be a single totally-ordered UTC value. The IANA zone
-- is retained alongside it because it is *authoring* information — it is
-- what lets the UI render "09:00 your time" and what lets a recurring slot
-- be re-expanded correctly across a DST transition. Storing only the
-- instant loses the user's intent; storing only local time makes the due
-- query impossible.
--
-- PRIVACY: every table here carries `user_id` referencing users(id) on
-- delete cascade, so `privacy.erase_user` (which just deletes the users
-- row) removes all of it, and the GDPR data-portability export — which
-- discovers per-user tables from the catalog by looking for a `user_id`
-- column — picks all three up automatically. `scheduled_post_variants`
-- carries a denormalized `user_id` for that reason, exactly like
-- headshot_variants in 0035.

-- Templates first: scheduled_posts references this table.
create table if not exists recurring_slots (
    id           uuid primary key default gen_random_uuid(),
    user_id      text not null references users(id) on delete cascade,
    label        text not null default '',
    -- 0 = Monday .. 6 = Sunday, matching Python's datetime.weekday() so
    -- slots.expand needs no translation table.
    weekday      integer not null check (weekday between 0 and 6),
    hour         integer not null check (hour between 0 and 23),
    minute       integer not null default 0 check (minute between 0 and 59),
    -- IANA zone name. The wall-clock (hour, minute) above is meaningless
    -- without it, which is why it is not null with a safe default.
    timezone     text not null default 'UTC',
    -- Ayrshare platform names; validated in code against
    -- scheduling.schemas.SUPPORTED_PLATFORMS. Not an enum: the supported
    -- set is a provider's vocabulary and changes without a migration.
    platforms    jsonb not null default '[]'::jsonb,
    active       boolean not null default true,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);
-- list_slots orders by (weekday, hour, minute) inside one user.
create index if not exists recurring_slots_user_idx
    on recurring_slots (user_id, weekday, hour, minute);

create table if not exists scheduled_posts (
    id                uuid primary key default gen_random_uuid(),
    user_id           text not null references users(id) on delete cascade,
    -- Default copy/media. Per-platform overrides live on the variant rows;
    -- NULL there means "inherit these", so these two must never be null.
    content           text not null default '',
    media_urls        jsonb not null default '[]'::jsonb,
    -- The instant, always UTC. The dispatcher's due predicate.
    scheduled_at      timestamptz not null,
    -- The zone the user authored in — see the header comment.
    timezone          text not null default 'UTC',
    status            text not null default 'scheduled'
                      check (status in ('scheduled','dispatching','posted',
                                        'partial','failed')),
    -- 'partial' is a real terminal state, not a transient one: some
    -- platforms are live and some are not, and collapsing that to
    -- 'failed' would invite a retry that re-posts the live ones.
    --
    -- NOTE: there is deliberately no 'due' status. A post is due when
    -- scheduled_at <= now(), which claim_due evaluates atomically. A
    -- materialised 'due' would need its own sweeper and would add a
    -- second race (mark-due vs. claim) that buys nothing.
    source            text not null default 'manual'
                      check (source in ('manual','import','recurring')),
    -- Which template materialised this post, if any. `set null` rather
    -- than `cascade`: deleting a recurring template must not delete the
    -- concrete posts it already produced (some may already be live).
    recurring_slot_id uuid references recurring_slots(id) on delete set null,
    error             text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);
-- The calendar/list query: user + window, ordered by time.
create index if not exists scheduled_posts_user_idx
    on scheduled_posts (user_id, scheduled_at);
-- The dispatcher's hot path (`claim_due`): the due scan must never touch
-- the (much larger) tail of already-posted rows, hence the partial index.
create index if not exists scheduled_posts_due_idx
    on scheduled_posts (scheduled_at) where status = 'scheduled';
-- The stale-reap sweep (`reap_stale`): posts stranded in 'dispatching' by
-- a crashed dispatcher.
create index if not exists scheduled_posts_stale_idx
    on scheduled_posts (updated_at) where status = 'dispatching';
create index if not exists scheduled_posts_slot_idx
    on scheduled_posts (recurring_slot_id) where recurring_slot_id is not null;

create table if not exists scheduled_post_variants (
    id                uuid primary key default gen_random_uuid(),
    scheduled_post_id uuid not null
                      references scheduled_posts(id) on delete cascade,
    -- Denormalized from the parent so the GDPR export/erasure crawler
    -- (which keys on a user_id column) reaches this table without a join.
    -- Filled by the trigger below, because the repo's INSERTs deliberately
    -- fan out from the parent row and never name this column.
    user_id           text not null references users(id) on delete cascade,
    platform          text not null,
    -- NULL means "inherit the parent's". Distinct from '' which means
    -- "this platform posts empty copy" (legal for a media-only post) —
    -- so these columns must stay nullable.
    content           text,
    media_urls        jsonb,
    status            text not null default 'pending'
                      check (status in ('pending','dispatching','posted','failed')),
    provider_post_id  text,
    error             text,
    dispatched_at     timestamptz,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    -- Required by `update`'s `on conflict (scheduled_post_id, platform) do
    -- nothing`, and independently load-bearing: two rows for one
    -- destination would post twice.
    unique (scheduled_post_id, platform)
);
-- The unique constraint above already indexes (scheduled_post_id, platform),
-- which covers every per-post variant read.
create index if not exists scheduled_post_variants_user_idx
    on scheduled_post_variants (user_id, created_at desc);
-- Variant-level stale reap: a dispatcher that died mid-publish.
create index if not exists scheduled_post_variants_stale_idx
    on scheduled_post_variants (updated_at) where status = 'dispatching';

-- Fill the denormalized user_id from the parent post.
--
-- Why a trigger instead of naming the column in the INSERT: the parent and
-- its variants are created in ONE statement (a CTE fan-out) precisely so
-- there is no window in which a scheduled post exists with no
-- destinations. Threading user_id through every INSERT site would put the
-- correctness of the privacy cascade in the hands of each future caller;
-- the trigger makes it structural. NOT NULL is checked after BEFORE
-- triggers run, so the column stays non-nullable.
create or replace function scheduled_post_variant_user_id() returns trigger as $$
begin
    if new.user_id is null then
        select p.user_id into new.user_id
          from scheduled_posts p where p.id = new.scheduled_post_id;
    end if;
    return new;
end;
$$ language plpgsql;

drop trigger if exists scheduled_post_variants_user_id on scheduled_post_variants;
create trigger scheduled_post_variants_user_id
    before insert on scheduled_post_variants
    for each row execute function scheduled_post_variant_user_id();

-- NOTE: deliberately NO `set_updated_at()` BEFORE UPDATE trigger here,
-- unlike jobs / articles / micro_dramas. On those tables `updated_at` is
-- bookkeeping; on these it is the stale-reap CLOCK — `reap_stale` fails
-- rows whose `updated_at` is older than N minutes. A trigger that force-
-- rewrites it to now() on every UPDATE makes that clock unsettable, so
-- neither an operator nor an integration test can age a row to prove the
-- reaper works (verified: with the trigger installed, backdating
-- `updated_at` is a no-op and reap_stale reaps nothing). image_posts —
-- the reapable table this feature mirrors — has no such trigger for the
-- same reason, and tests/integration/test_pg_campaigns.py relies on
-- backdating image_posts.updated_at directly. Every write in
-- repos/scheduled_posts.py sets `updated_at = now()` explicitly instead.
