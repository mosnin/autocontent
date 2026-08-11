-- 0025: indexes supporting the admin ops-metrics queries.
--
-- The /ops/metrics endpoint polls every 30s and runs:
--   * provider_error_rates — joins spend_ledger to image_posts via
--     image_post_id (unlike job_id/article_id, this FK had no index and
--     forced a sequential scan of spend_ledger on every poll).
--   * stuck_work — filters jobs/image_posts by (status, updated_at) with
--     no user_id predicate; neither table had an index leading on status.
-- Partial indexes keep them tight (only rows that can match).

create index if not exists spend_ledger_image_post_idx
    on spend_ledger (image_post_id)
    where image_post_id is not null;

create index if not exists jobs_status_updated_idx
    on jobs (status, updated_at);

create index if not exists image_posts_status_updated_idx
    on image_posts (status, updated_at);
