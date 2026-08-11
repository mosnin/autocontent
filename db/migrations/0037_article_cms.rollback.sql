-- Rollback 0037.
--
-- Children first: article_collection_items FKs article_collections, and
-- article_revisions self-FKs (restored_from_revision_id), which a plain
-- table drop handles. Indexes go with their tables.
--
-- NOTE: dropping article_revisions destroys the only copy of pre-edit
-- article content. If any article has been hand-edited since 0037 was
-- applied, the prior versions are gone for good — export them first if
-- this rollback is a decommission rather than a reshape.
drop table if exists article_collection_items;
drop table if exists article_collections;
drop table if exists article_revisions;

-- Indexes on `articles` are dropped explicitly because the table survives.
drop index if exists articles_user_public_slug_uniq;
drop index if exists articles_scheduled_due_idx;
drop index if exists articles_user_pubstate_idx;

alter table articles drop constraint if exists articles_publication_state_chk;
alter table articles drop constraint if exists articles_scheduled_needs_time_chk;
alter table articles drop constraint if exists articles_published_needs_time_chk;

-- Dropping these columns unpublishes every live article. That is the
-- correct semantic for a rollback (the code that serves them is gone too),
-- but it is not recoverable.
alter table articles
    drop column if exists publication_state,
    drop column if exists published_at,
    drop column if exists scheduled_at;
