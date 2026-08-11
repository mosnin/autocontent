-- 0039: Gatekeeper intents + audit.
--
-- `gatekeeper_intents` holds actions an agent performed SPECULATIVELY: the
-- Gatekeeper simulated the outcome, handed the agent a plausible result so
-- it could keep planning, and parked the real effect here for a human to
-- approve in bulk later.
--
-- Why a dedicated table rather than reusing ad_approvals: ad_approvals is
-- specific to ad campaigns and stores a budget delta. An intent is generic
-- over every capability (publish a post, create a creative, raise a bid),
-- and it additionally stores the SIMULATED result — which ad_approvals has
-- no concept of, and which is what makes divergence detection possible.
--
-- The `simulated` / `observed` pair is the load-bearing part. When an
-- intent is applied we record what actually came back; if it contradicts
-- what the agent was told, `diverged` is set and the row stops being a
-- clean success. An agent that planned three steps on top of a simulated
-- result needs to know the ground moved.

create table if not exists gatekeeper_intents (
    id              uuid primary key default gen_random_uuid(),
    user_id         text not null references users(id) on delete cascade,
    capability      text not null,
    -- Human sentence for the approval inbox. Denormalized on purpose: an
    -- approver reads this, never the params blob, and it must survive a
    -- later change to how the capability describes itself.
    summary         text not null default '',
    params          jsonb not null default '{}'::jsonb,
    simulated       jsonb,
    observed        jsonb,
    -- pending | approved | rejected | applied | failed | expired
    status          text not null default 'pending',
    -- Policy's own record, so an approver sees why this needed them.
    reason          text not null default '',
    dollar_delta    numeric(12,2) not null default 0,
    evidence        jsonb not null default '{}'::jsonb,
    -- 'human' | 'agent' | 'system' — an agent-initiated action and a
    -- human-initiated one get different scrutiny in the inbox.
    actor           text not null default 'agent',
    origin          text not null default '',
    -- Set when the applied result contradicted what was simulated.
    diverged        text,
    error           text,
    decided_by      text,
    decided_at      timestamptz,
    applied_at      timestamptz,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

-- The inbox query: this user's pending intents, newest first.
create index if not exists gatekeeper_intents_user_status_idx
    on gatekeeper_intents (user_id, status, created_at desc);

-- The apply worker's queue: approved-but-not-yet-applied, across users.
create index if not exists gatekeeper_intents_apply_idx
    on gatekeeper_intents (status, decided_at)
    where status = 'approved';

-- Reaping intents stranded mid-apply by a dead container.
create index if not exists gatekeeper_intents_stale_idx
    on gatekeeper_intents (status, updated_at);

-- Append-only. Every simulate / approve / reject / apply / deny lands here,
-- including the ones that never became an intent (a plain ALLOW, a hard
-- DENY), so "what did the agent try" is answerable from storage rather
-- than from logs. No update or delete path exists in the repo.
create table if not exists gatekeeper_audit (
    id              bigserial primary key,
    user_id         text not null references users(id) on delete cascade,
    capability      text not null,
    -- allow | deny | speculate | approve | reject | apply | diverge
    verdict         text not null,
    summary         text not null default '',
    reason          text not null default '',
    actor           text not null default 'agent',
    origin          text not null default '',
    intent_id       uuid references gatekeeper_intents(id) on delete set null,
    created_at      timestamptz not null default now()
);

create index if not exists gatekeeper_audit_user_idx
    on gatekeeper_audit (user_id, created_at desc);

create index if not exists gatekeeper_audit_intent_idx
    on gatekeeper_audit (intent_id)
    where intent_id is not null;
