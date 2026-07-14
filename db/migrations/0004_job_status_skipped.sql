-- 0004_job_status_skipped.sql — add 'skipped' to the job_status enum.
--
-- A job is marked skipped when the niche advisory lock is already held by
-- another running job (prevents character-sheet write races) or when the
-- per-user concurrency cap would block indefinitely.
--
-- Apply with:
--   psql "$SUPABASE_DB_URL" -f db/migrations/0004_job_status_skipped.sql

alter type job_status add value if not exists 'skipped';
