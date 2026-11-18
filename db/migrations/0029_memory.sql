-- 0029: memory — temporal facts with provenance, learnings with evidence,
-- and an append-only audit of every change (plan section 3 of
-- docs/research/EVALUATION.md; ADR 0009 and 0010; docs/memory/).
--
-- memory_facts: one row per version of a fact about a user's marketing world
-- (brand, audience, offers, competitors, channels, campaigns, creatives,
-- claims, rules, preferences). A fact is never deleted when it stops being
-- true: it gets invalid_at, a reason and superseded_by. Reads default to
-- "current": invalid_at is null and not pending.
--
--   subject_*        the entity the fact is about; subject_key is the slug
--                    of the name, so "Pasta Club" and "pasta club" are one.
--   predicate        an attribute or relation from the marketing ontology
--                    (validated in code, src/marketer/repos/memory.py).
--   value            attribute facts. Null on relations and on tombstones.
--   object_*         relation facts: the entity pointed at.
--   source_*         where the fact came from: which message, tool call,
--                    document or URL, when, and a short redacted excerpt.
--   trust            trusted (the person, in the app) | unconfirmed (read
--                    from the person's chat, jobs, metrics) | untrusted
--                    (web, documents, tool output). Derived from source_kind
--                    in code, never taken from a request body.
--   pending          waiting for the person: a rule-bearing fact from a
--                    non-person source, or a lower-trust value that
--                    disagrees with the current one (challenges = its id).
--   invalid_reason   superseded | corrected | merged | forgotten | dismissed.
--                    forgotten / dismissed rows are tombstones: value,
--                    object name, excerpt and source_ref are wiped, and
--                    value_hash stays so the same value is not learned again
--                    from a non-person source.
--   value_hash       sha256 of the normalised content, for duplicates.
--
-- Rows go away with their user (FK cascade), so erasure stays complete.

create table if not exists memory_facts (
    id             uuid primary key default gen_random_uuid(),
    user_id        text not null references users(id) on delete cascade,
    subject_type   text not null,
    subject_name   text not null check (char_length(subject_name) <= 120),
    subject_key    text not null check (char_length(subject_key) <= 120),
    predicate      text not null check (char_length(predicate) <= 64),
    kind           text not null check (kind in ('attribute', 'relation')),
    value          text check (value is null or char_length(value) <= 500),
    object_type    text,
    object_name    text check (object_name is null or char_length(object_name) <= 120),
    object_key     text check (object_key is null or char_length(object_key) <= 120),
    source_kind    text not null check (source_kind in
                       ('person', 'message', 'approval', 'job', 'metric', 'tool', 'document', 'web')),
    source_ref     text not null check (char_length(source_ref) <= 200),
    source_at      timestamptz not null default now(),
    source_excerpt text check (source_excerpt is null or char_length(source_excerpt) <= 300),
    trust          text not null check (trust in ('trusted', 'unconfirmed', 'untrusted')),
    confidence     real not null default 0.6 check (confidence >= 0 and confidence <= 1),
    valid_from     timestamptz not null default now(),
    invalid_at     timestamptz,
    invalid_reason text check (invalid_reason in
                       ('superseded', 'corrected', 'merged', 'forgotten', 'dismissed')),
    superseded_by  uuid references memory_facts(id) on delete set null,
    pending        boolean not null default false,
    challenges     uuid references memory_facts(id) on delete set null,
    value_hash     text not null,
    created_at     timestamptz not null default now(),
    -- An invalid fact always says why; a live one never does.
    check ((invalid_at is null) = (invalid_reason is null)),
    -- A fact the person confirmed is never left waiting for the person.
    check (not (trust = 'trusted' and pending))
);

-- The slot (subject + predicate): history, supersede and duplicate checks.
create index if not exists memory_facts_slot_idx
    on memory_facts (user_id, subject_type, subject_key, predicate);
-- The read path: a user's current facts, newest first.
create index if not exists memory_facts_current_idx
    on memory_facts (user_id, valid_from desc) where invalid_at is null and not pending;
-- At most one live fact per content in a slot, even when two writers race.
create unique index if not exists memory_facts_live_content_idx
    on memory_facts (user_id, subject_type, subject_key, predicate, value_hash)
    where invalid_at is null;

-- memory_learnings: what worked and what did not. A learning always carries
-- evidence (a JSON array of {kind, ref, label, metric?, value?, n?, lift?,
-- window?}); "supported" and "refuted" need a measured item (checked in code).
create table if not exists memory_learnings (
    id         uuid primary key default gen_random_uuid(),
    user_id    text not null references users(id) on delete cascade,
    claim      text not null check (char_length(claim) between 1 and 300),
    status     text not null check (status in ('hypothesis', 'supported', 'refuted')),
    evidence   jsonb not null check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) >= 1),
    confidence real not null default 0.4 check (confidence >= 0 and confidence <= 1),
    source     text not null check (source in ('analyst', 'person', 'system')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists memory_learnings_user_idx
    on memory_learnings (user_id, updated_at desc);

-- memory_audit: who changed what in memory, and when. Append-only. `detail`
-- holds the slot and the reason, never a fact's content, so the audit cannot
-- leak what a person asked to forget.
create table if not exists memory_audit (
    id          uuid primary key default gen_random_uuid(),
    user_id     text not null references users(id) on delete cascade,
    actor       text not null check (actor in ('person', 'agent', 'system')),
    action      text not null check (action in
                    ('fact.created', 'fact.superseded', 'fact.pending', 'fact.confirmed',
                     'fact.corrected', 'fact.forgotten', 'fact.merged',
                     'learning.recorded', 'learning.status')),
    fact_id     uuid,
    learning_id uuid,
    detail      text not null default '' check (char_length(detail) <= 300),
    created_at  timestamptz not null default now()
);

create index if not exists memory_audit_user_idx
    on memory_audit (user_id, created_at desc, id desc);

create or replace function memory_audit_append_only() returns trigger as $$
begin
    raise exception 'memory_audit is append-only';
end;
$$ language plpgsql;

drop trigger if exists memory_audit_append_only on memory_audit;
create trigger memory_audit_append_only before update on memory_audit
    for each row execute function memory_audit_append_only();
