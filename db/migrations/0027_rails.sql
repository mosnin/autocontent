-- 0027: execution rails (docs/rails/README.md).
--
-- rails_executions: one row per HIGH/CRITICAL dispatch that passed (or was
-- refused by) the enforcement point in marketer.rails.enforce. It records
-- who asked (principal), what exactly (action + canonical args_hash), against
-- what (target), under which idempotency key and approval, and how it ended.
--
-- Lifecycle (each transition is a guarded UPDATE, first commit wins):
--   outcome null ('dispatching')  -> succeeded | failed | indeterminate
--   refused at the enforcement point -> inserted with outcome 'denied'
--   indeterminate (or dispatching for > 15 min) -> resolved once by a person:
--     resolution = confirmed_succeeded | confirmed_failed
-- Rows are never deleted by the application. An unresolved indeterminate row
-- is a Required Action in the workspace inbox and blocks new dispatches on
-- the same target (docs/rails/failure-semantics.md).
--
-- Approval binding for ad approvals lives in ad_approvals.payload_json under
-- "rails" ({args_hash, governance_hash}), written in the same INSERT as the
-- approval itself, so no column is added there (docs/rails/approvals.md).
-- Idempotency claims reuse idempotency_keys from 0024.
-- Global kill switches reuse feature_flags from 0011
-- (rails.kill_switch.all | .publish | .spend).

create table if not exists rails_executions (
    id              uuid primary key default gen_random_uuid(),
    user_id         text not null references users(id) on delete cascade,
    action          text not null,
    tier            text not null check (tier in ('HIGH', 'CRITICAL')),
    principal       text not null check (principal in ('user', 'agent', 'system')),
    actor_email     text not null default '',
    target_type     text not null default '',
    target_id       text not null default '',
    args_hash       text not null,
    idempotency_key text,
    approval_id     uuid,
    outcome         text check (outcome in ('succeeded', 'failed', 'indeterminate', 'denied')),
    detail          jsonb not null default '{}'::jsonb,
    error           text not null default '',
    resolution      text check (resolution in ('confirmed_succeeded', 'confirmed_failed')),
    resolved_by     text not null default '',
    resolved_at     timestamptz,
    created_at      timestamptz not null default now(),
    ended_at        timestamptz
);

comment on table rails_executions is
    'Execution rails ledger. Append-mostly: rows are inserted once and each outcome/resolution field is set once by a guarded UPDATE; never deleted by the application.';

-- Duplicate detection by the agent's idempotency key.
create index if not exists rails_executions_key_idx
    on rails_executions (user_id, action, idempotency_key)
    where idempotency_key is not null;

-- "Is anything unresolved on this target?" (checked on every dispatch).
create index if not exists rails_executions_target_idx
    on rails_executions (user_id, target_type, target_id)
    where resolution is null and (outcome is null or outcome = 'indeterminate');

-- The inbox lane: newest unresolved per user.
create index if not exists rails_executions_user_created_idx
    on rails_executions (user_id, created_at desc);
