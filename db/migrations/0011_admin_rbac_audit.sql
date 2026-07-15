-- 0011: admin RBAC + SOC2 audit trail.
--
-- Adds least-privilege role separation, an append-only audit log of every
-- privileged (admin) action, a suspension flag for abuse response, and an
-- admin-managed feature-flag table. Designed so the audit trail is the
-- system of record for who did what: rows are never updated or deleted by
-- the application.

create type user_role as enum ('user', 'admin');

alter table users
    add column if not exists role user_role not null default 'user',
    -- Suspension is an access control, not deletion: a suspended user keeps
    -- their data but every authed request is refused (see backend/auth.py).
    add column if not exists suspended_at timestamptz,
    add column if not exists suspended_reason text;

-- Append-only audit log. Every admin route records exactly one row per
-- privileged action with the actor, action, target, and request context.
-- No FK on actor/target ids so history survives user deletion (SOC2:
-- audit records must outlive the subjects they reference).
create table if not exists admin_audit_log (
    id            bigserial primary key,
    actor_id      text not null,               -- admin user id (Clerk sub)
    actor_email   text not null default '',
    action        text not null,               -- e.g. 'user.suspend', 'credits.grant'
    target_type   text,                        -- 'user' | 'job' | 'article' | 'system'
    target_id     text,
    ip            text,
    user_agent    text,
    metadata      jsonb not null default '{}'::jsonb,
    created_at    timestamptz not null default now()
);

create index if not exists admin_audit_actor_idx on admin_audit_log(actor_id, created_at desc);
create index if not exists admin_audit_target_idx on admin_audit_log(target_type, target_id, created_at desc);
create index if not exists admin_audit_created_idx on admin_audit_log(created_at desc);

-- Revoke UPDATE/DELETE at the table level would require a dedicated role;
-- we enforce append-only in the application layer (repo exposes insert +
-- select only) and document the intent here for auditors.
comment on table admin_audit_log is
    'Append-only. Application never updates or deletes rows. System of record for admin actions (SOC2 CC7.2).';

-- Admin-managed feature flags. Simple global on/off + optional JSON payload;
-- per-user targeting can layer on later via metadata.
create table if not exists feature_flags (
    key           text primary key,
    enabled       boolean not null default false,
    description   text not null default '',
    updated_by    text,
    updated_at    timestamptz not null default now(),
    created_at    timestamptz not null default now()
);

drop trigger if exists feature_flags_updated_at on feature_flags;
create trigger feature_flags_updated_at before update on feature_flags
    for each row execute function set_updated_at();
