-- 0024: durable idempotency store for Modal spawn dedup.
--
-- Guards exactly-once execution around Modal entrypoints that are
-- vulnerable to a genuine duplicate-spawn window (retry races, cron
-- overlap) and are NOT already covered by an atomic status claim
-- (cycle-1's claim_for_retry/claim_for_scheduling + reap_stale on
-- image_posts/jobs already make those paths safe).
--
-- key:        the caller-derived idempotency key (see
--             marketer.services.idempotency for the key scheme). Primary
--             key gives us the atomic "first writer wins" semantics via
--             INSERT ... ON CONFLICT DO NOTHING.
-- created_at: when this key was first claimed.
-- expires_at: when the claim stops blocking a re-claim of the same key
--             (a legitimate later attempt reusing the same identity, or
--             cleanup after a crashed claimant never released/completed).
-- status:     'claimed' (in flight) or 'done' (completed) — informational;
--             claim semantics only depend on presence + expires_at.
-- result:     optional small jsonb breadcrumb (e.g. which container claimed
--             it) for debugging double-spawn incidents. Never load-bearing.

create table if not exists idempotency_keys (
    key         text primary key,
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null,
    status      text not null default 'claimed',
    result      jsonb
);

-- Reaper sweeps by expires_at; this index makes that a cheap range scan
-- instead of a sequential scan as the table grows.
create index if not exists idempotency_keys_expires_at_idx
    on idempotency_keys (expires_at);
