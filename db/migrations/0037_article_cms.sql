-- 0037: article CMS — hand editing, revision history, publication state,
-- and collections.
--
-- The article pipeline (0010) is write-once from the operator's point of
-- view: it generates a row and the API reads it back. `articles.status` is
-- a PIPELINE status (queued -> ... -> done|failed), i.e. "has the machine
-- finished writing", which is a different axis from "is this live on the
-- web". This migration adds the second axis plus the two tables a CMS
-- needs around it.
--
-- Design notes that are easy to get wrong later:
--
--  * publication_state is deliberately a separate column from status
--    rather than two more values in the article_status enum. An article
--    can be `status='done', publication_state='draft'` (written, not
--    live) or `status='done', publication_state='published'`. Folding
--    them together would make "re-run the pipeline on a published
--    article" unrepresentable.
--
--  * The slug uniqueness index is PARTIAL — it only covers rows that
--    actually back a public URL (scheduled/published). Two drafts may
--    share a slug because neither is addressable, and, critically, the
--    article pipeline only ever writes draft rows: a unique index over
--    all rows would let an unlucky LLM-generated slug abort a generation
--    run mid-flight. Collisions are therefore resolved exactly where a
--    URL is minted (publish / slug edit), in code, with this index as the
--    race backstop.
--
--  * article_revisions is APPEND-ONLY by discipline, like
--    admin_audit_log: the repo module exposes insert + select and no
--    update/delete. Restoring an old revision writes a NEW revision
--    rather than rewinding history.
--
--  * Every new table carries user_id with an FK cascade from users(id).
--    That is what puts it in the `DELETE /users/me` erasure cascade and
--    what makes the GDPR data-portability export (which discovers
--    per-user tables from the catalog by looking for a `user_id` column)
--    pick it up automatically.

-- ---------------------------------------------------------------------------
-- Publication state on articles
-- ---------------------------------------------------------------------------

alter table articles
    add column if not exists publication_state text not null default 'draft',
    -- When the article first went live. Deliberately NOT cleared on
    -- unpublish: a re-publish should restore the original dateline rather
    -- than mint a new one (a moving publish date reads as content churn to
    -- crawlers and re-triggers feed readers). Publication is decided by
    -- publication_state alone; published_at is history, not a flag.
    add column if not exists published_at timestamptz,
    -- Target instant for a scheduled publish. Null unless state='scheduled'.
    add column if not exists scheduled_at timestamptz;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'articles_publication_state_chk'
    ) then
        alter table articles
            add constraint articles_publication_state_chk
            check (publication_state in ('draft', 'scheduled', 'published'));
    end if;

    -- A scheduled row with no scheduled_at would never be picked up by the
    -- due sweep: it would sit "scheduled" forever and never go live. Make
    -- that state unrepresentable rather than debuggable.
    if not exists (
        select 1 from pg_constraint where conname = 'articles_scheduled_needs_time_chk'
    ) then
        alter table articles
            add constraint articles_scheduled_needs_time_chk
            check (publication_state <> 'scheduled' or scheduled_at is not null);
    end if;

    -- Same argument in the other direction: a published row with no
    -- published_at renders a live page with no date.
    if not exists (
        select 1 from pg_constraint where conname = 'articles_published_needs_time_chk'
    ) then
        alter table articles
            add constraint articles_published_needs_time_chk
            check (publication_state <> 'published' or published_at is not null);
    end if;
end $$;

-- THE public-URL invariant. Two articles of one user must never resolve to
-- the same public slug; without a DB-level index, two concurrent publishes
-- that both read "slug is free" would both write it and mint a duplicate
-- URL.
--
-- The predicate covers rows that are public *or have ever been public*
-- (published_at survives an unpublish — see the column comment). Retiring
-- a slug to the article that once served it is what stops an old inbound
-- link from silently resolving to unrelated content after an unpublish;
-- the matching application rule is "a slug that has ever been public is
-- frozen" (see cms/publish.py::guard_slug_change).
--
-- Still partial, and still empty at migration time: every existing row
-- defaults to publication_state='draft' with published_at null. That is
-- what makes this index safe to add to a live `articles` table, and what
-- guarantees it can never fire on the pipeline's draft writes and abort a
-- generation run over an unlucky LLM-chosen slug.
create unique index if not exists articles_user_public_slug_uniq
    on articles (user_id, slug)
    where slug is not null
      and (publication_state in ('scheduled', 'published') or published_at is not null);

-- Due-sweep support: find scheduled articles whose time has come.
create index if not exists articles_scheduled_due_idx
    on articles (scheduled_at)
    where publication_state = 'scheduled';

-- Publication-state filtered listing ("show me everything live").
create index if not exists articles_user_pubstate_idx
    on articles (user_id, publication_state, created_at desc);

-- ---------------------------------------------------------------------------
-- Revision history
-- ---------------------------------------------------------------------------

create table if not exists article_revisions (
    id            uuid primary key default gen_random_uuid(),
    article_id    uuid not null references articles(id) on delete cascade,
    -- Denormalized from the article so ownership is a single predicate and
    -- so the GDPR export/erasure crawler reaches this table without a join.
    user_id       text not null references users(id) on delete cascade,
    -- Monotonic per article, assigned under a row lock on the article (see
    -- repos/article_revisions.py). Gives the UI a stable "v3" label that
    -- created_at ordering alone cannot promise across clock skew.
    revision_number integer not null,

    -- Snapshot of the PRIOR version of the editable surface — i.e. what the
    -- article looked like BEFORE the edit this row records. Storing the
    -- before-state (rather than the after-state) is what makes restore a
    -- simple "write this snapshot forward" with no replay.
    title            text,
    slug             text,
    meta_description text,
    article_markdown text,

    -- Which of the four editable fields actually changed, and a short
    -- human summary, both computed at capture time so the list endpoint
    -- never has to diff blobs.
    changed_fields text[] not null default '{}',
    summary        text not null default '',
    -- 'edit'    — captured by a PATCH
    -- 'restore' — captured by a restore (the state being replaced)
    source         text not null default 'edit'
                   check (source in ('edit', 'restore')),
    -- Set when source='restore': which revision's content was written
    -- forward. Nulled rather than cascaded on delete so history survives.
    restored_from_revision_id uuid references article_revisions(id) on delete set null,

    created_at    timestamptz not null default now(),

    unique (article_id, revision_number)
);

create index if not exists article_revisions_article_idx
    on article_revisions (article_id, revision_number desc);
create index if not exists article_revisions_user_idx
    on article_revisions (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Collections
-- ---------------------------------------------------------------------------
--
-- A collection is a lightweight, user-named grouping of articles — the
-- source CMS's "blog group"/folder. It is NOT a niche: a niche is a heavy
-- channel configuration (posting windows, spend cap, video provider, TTS
-- voice, creative brief) that drives generation, and an article belongs to
-- exactly one. A collection carries no generation settings, an article can
-- be in several, and putting one article in two collections must not
-- change how it is written.

create table if not exists article_collections (
    id          uuid primary key default gen_random_uuid(),
    user_id     text not null references users(id) on delete cascade,
    name        text not null,
    -- Per-user unique so a collection can back a public /c/{slug} index
    -- page. Unlike article slugs this one is unconditionally unique: a
    -- collection has no "draft" phase to be exempt.
    slug        text not null,
    description text not null default '',
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),

    unique (user_id, slug)
);

create index if not exists article_collections_user_idx
    on article_collections (user_id, created_at desc);

drop trigger if exists article_collections_updated_at on article_collections;
create trigger article_collections_updated_at before update on article_collections
    for each row execute function set_updated_at();

-- Junction rather than a collection_id column on articles: membership is
-- many-to-many, and keeping it out of `articles` means the article read
-- path (repos/articles.py, owned by the pipeline) is untouched by this
-- feature.
create table if not exists article_collection_items (
    collection_id uuid not null references article_collections(id) on delete cascade,
    article_id    uuid not null references articles(id) on delete cascade,
    -- Denormalized for the same two reasons as on article_revisions.
    user_id       text not null references users(id) on delete cascade,
    -- Manual ordering for a curated index page; ties break on added_at.
    position      integer not null default 0,
    added_at      timestamptz not null default now(),

    primary key (collection_id, article_id)
);

create index if not exists article_collection_items_article_idx
    on article_collection_items (article_id);
create index if not exists article_collection_items_user_idx
    on article_collection_items (user_id, added_at desc);
