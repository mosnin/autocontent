-- 0026: decision_log — one row per decision-model call.
--
-- Every decision point (backend pipelines, agent, onboarding) logs here:
-- which point, which pinned model, which questions version, a hash of the
-- state (never the state itself: no raw PII), the typed answers, whether the
-- rule-based fallback was used, latency, cost and the action actually taken.
--
-- Append-only. The decision columns are immutable once written; the only
-- columns that change later are `outcome`, `correction` and `outcome_at`,
-- filled when the truth is known (a person's override, post engagement, a
-- QA result). That "correction next to the answer" pair is the labelled data
-- used to tune a point's threshold before it is promoted to enforce.
-- Rows still go away with their user (FK cascade) so erasure stays complete.
--
-- point:             decision point id, e.g. 'hook_score', 'budget_shift'.
-- mode:              'off' | 'shadow' | 'enforce' at the time of the call.
-- questions_version: version of the question set, e.g. 'hook_score.v1'.
-- state_hash:        sha256 of the canonical JSON state.
-- answers:           normalised answers, null when the call failed.
-- reason:            why the call failed (timeout, http, invalid, ...).
-- action_taken:      what the caller actually did.
-- rule_action:       what today's rule says (equals action_taken in shadow).
-- table_action:      what the truth table chose; null when the call failed.
-- subject_kind/id:   what was decided about (job, article, campaign, ...).

create table if not exists decision_log (
    id                uuid primary key default gen_random_uuid(),
    user_id           text not null references users(id) on delete cascade,
    point             text not null,
    mode              text not null check (mode in ('off', 'shadow', 'enforce')),
    model             text,
    questions_version text not null,
    state_hash        text not null default '',
    answers           jsonb,
    fallback_used     boolean not null,
    reason            text,
    latency_ms        integer not null default 0 check (latency_ms >= 0),
    cost_usd          numeric(12, 8) check (cost_usd is null or cost_usd >= 0),
    action_taken      text not null,
    rule_action       text,
    table_action      text,
    subject_kind      text,
    subject_id        text,
    outcome           jsonb,
    correction        jsonb,
    outcome_at        timestamptz,
    created_at        timestamptz not null default now()
);

-- The caller's own log, newest first, keyset-paginated on (created_at, id).
create index if not exists decision_log_user_created_idx
    on decision_log (user_id, created_at desc, id desc);
-- Per-point tuning reads.
create index if not exists decision_log_point_created_idx
    on decision_log (point, created_at desc);

-- Append-only guard: only outcome / correction / outcome_at may change.
create or replace function decision_log_append_only() returns trigger as $$
begin
    if (new.id, new.user_id, new.point, new.mode, new.model, new.questions_version,
        new.state_hash, new.answers, new.fallback_used, new.reason, new.latency_ms,
        new.cost_usd, new.action_taken, new.rule_action, new.table_action,
        new.subject_kind, new.subject_id, new.created_at)
       is distinct from
       (old.id, old.user_id, old.point, old.mode, old.model, old.questions_version,
        old.state_hash, old.answers, old.fallback_used, old.reason, old.latency_ms,
        old.cost_usd, old.action_taken, old.rule_action, old.table_action,
        old.subject_kind, old.subject_id, old.created_at)
    then
        raise exception 'decision_log is append-only: only outcome, correction and outcome_at may change';
    end if;
    return new;
end;
$$ language plpgsql;

drop trigger if exists decision_log_append_only on decision_log;
create trigger decision_log_append_only before update on decision_log
    for each row execute function decision_log_append_only();
