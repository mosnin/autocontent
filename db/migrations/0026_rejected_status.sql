-- 0026: a real 'rejected' job status.
--
-- An operator veto is a decision, not a failure. Until now reject marked
-- the job 'failed', so a rejected video showed up red in the queue and in
-- the failures inbox with a Retry button — the product recorded the
-- customer's own choice as an error. 'rejected' keeps the distinction:
-- it is terminal, excluded from failure triage, and not retryable.
--
-- Note: ALTER TYPE ... ADD VALUE cannot be used inside the same
-- transaction that uses the value (PG >= 12 allows the ALTER itself in a
-- transaction). This migration only adds the value.

alter type job_status add value if not exists 'rejected';
