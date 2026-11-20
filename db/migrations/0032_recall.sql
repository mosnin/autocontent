-- 0032: personal and team recall on Supermemory (docs/memory/supermemory.md).
--
-- 1. users.supermemory_enabled: the workspace setting. Off by default; only
--    security:manage changes it (backend/routes/memory.py).
-- 2. recall_subjects: the personal namespaces that may exist, one row per
--    (tenant, person) the backend has told the agent it may write for. The
--    namespace itself is never stored: it is derived from these ids.
-- 3. recall_purge_queue: namespaces to delete. A row stays 'pending' until
--    Supermemory confirms the delete (fail closed), and is retried with backoff.
-- 4. recall_audit_cursor: how far the purge job has read security_audit_log.
-- 5. recall_mirror: what the team namespace holds from Postgres (content hash
--    per document), so mirroring sends only changes and removes what is gone.
--
-- None of the recall_* tables references users(id) and none has a user_id
-- column, on purpose: an account erasure (delete from users ... cascade) must
-- not erase the queue that deletes its Supermemory data, and the privacy
-- export (every table with a user_id column) must not dump other people's
-- subject rows into a workspace export.

alter table users add column if not exists supermemory_enabled boolean not null default false;
alter table users add column if not exists supermemory_updated_at timestamptz;

create table if not exists recall_subjects (
    tenant_id   text not null check (length(tenant_id) between 1 and 256 and position('|' in tenant_id) = 0),
    person_id   text not null check (length(person_id) between 1 and 256 and position('|' in person_id) = 0),
    org_id      text,
    first_seen  timestamptz not null default now(),
    last_seen   timestamptz not null default now(),
    primary key (tenant_id, person_id)
);
create index if not exists recall_subjects_person_idx on recall_subjects (person_id);
create index if not exists recall_subjects_org_idx on recall_subjects (org_id) where org_id is not null;

create table if not exists recall_purge_queue (
    id              bigserial primary key,
    kind            text not null check (kind in ('personal', 'team')),
    tenant_id       text not null check (length(tenant_id) between 1 and 256 and position('|' in tenant_id) = 0),
    person_id       text check (person_id is null or (length(person_id) between 1 and 256 and position('|' in person_id) = 0)),
    reason          text not null check (reason ~ '^[a-z_]+(\.[a-z_]+)*$'),
    status          text not null default 'pending' check (status in ('pending', 'done')),
    attempts        integer not null default 0,
    last_error      text check (last_error is null or length(last_error) <= 200),
    created_at      timestamptz not null default now(),
    next_attempt_at timestamptz not null default now(),
    done_at         timestamptz,
    check ((kind = 'team') = (person_id is null))
);
-- One pending delete per namespace: enqueueing again is a no-op (idempotent).
create unique index if not exists recall_purge_pending_uq
    on recall_purge_queue (kind, tenant_id, coalesce(person_id, '')) where status = 'pending';
create index if not exists recall_purge_due_idx on recall_purge_queue (next_attempt_at) where status = 'pending';

create table if not exists recall_audit_cursor (
    name     text primary key,
    last_id  bigint not null default 0,
    updated_at timestamptz not null default now()
);

create table if not exists recall_mirror (
    tenant_id    text not null,
    doc_id       text not null check (length(doc_id) between 1 and 255),
    content_hash text not null,
    synced_at    timestamptz not null default now(),
    primary key (tenant_id, doc_id)
);

comment on table recall_purge_queue is
    'Supermemory namespaces to delete (docs/memory/supermemory.md, Lifecycle). Pending until confirmed; no FK so erasure keeps it.';
