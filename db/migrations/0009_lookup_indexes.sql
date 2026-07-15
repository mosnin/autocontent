-- 0009: indexes for hot lookups that were sequential scans.
--
-- 1. Ayrshare webhooks resolve jobs by payload->>'provider_post_id';
--    without an expression index every delivery full-scans jobs and
--    parses every payload blob.
-- 2. cost_by_job aggregates spend_ledger by job_id, which only limped
--    along on the user_id prefix of the day index.

create index if not exists jobs_provider_post_id_idx
    on jobs ((payload->>'provider_post_id'))
    where payload->>'provider_post_id' is not null;

create index if not exists spend_ledger_job_idx
    on spend_ledger (job_id);
