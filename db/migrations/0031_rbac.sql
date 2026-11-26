-- 0031: workspace roles in the product schema (docs/auth/README.md, ADR 0011).
--
-- 1. public.security_audit_log: append-only record of security events, written
--    by web (sign-ins, 2FA, invitations, role changes, SSO) and by the backend
--    (permission denials, token creation and revocation). A trigger refuses
--    UPDATE, DELETE and TRUNCATE, so history cannot be rewritten by the
--    application or anyone using its role. No FK on any id: audit rows outlive
--    the people, workspaces and tenants they mention (account erasure keeps
--    them). metadata never holds secrets, tokens or passwords.
--
-- 2. personal_access_tokens.role / created_by: a token acts with a workspace
--    role (at most its creator's when created) and dies with its creator's
--    membership. Tokens that existed before workspaces become 'admin' with the
--    tenant as creator, which the backend treats as the legacy case.

create table if not exists security_audit_log (
    id           bigserial primary key,
    at           timestamptz not null default now(),
    org_id       text,
    tenant_id    text,
    actor_id     text,
    actor_email  text not null default '',
    actor_type   text not null
                 check (actor_type in ('user', 'agent', 'token', 'platform_admin', 'system')),
    action       text not null check (action ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$'),
    target_type  text,
    target_id    text,
    outcome      text not null check (outcome in ('success', 'denied', 'failure')),
    ip           text,
    user_agent   text check (user_agent is null or length(user_agent) <= 512),
    metadata     jsonb not null default '{}'::jsonb
);

create index if not exists security_audit_log_org_idx
    on security_audit_log (org_id, id desc) where org_id is not null;
create index if not exists security_audit_log_tenant_idx
    on security_audit_log (tenant_id, id desc) where tenant_id is not null;
create index if not exists security_audit_log_actor_idx
    on security_audit_log (actor_id, at desc) where actor_id is not null;

create or replace function security_audit_log_append_only() returns trigger as $$
begin
    raise exception 'security_audit_log is append-only';
end;
$$ language plpgsql;

drop trigger if exists security_audit_log_no_update on security_audit_log;
create trigger security_audit_log_no_update before update or delete on security_audit_log
    for each row execute function security_audit_log_append_only();

drop trigger if exists security_audit_log_no_truncate on security_audit_log;
create trigger security_audit_log_no_truncate before truncate on security_audit_log
    for each statement execute function security_audit_log_append_only();

comment on table security_audit_log is
    'Append-only (trigger refuses UPDATE, DELETE, TRUNCATE). Security events from web and backend. See docs/auth/README.md.';

alter table personal_access_tokens
    add column if not exists role text,
    add column if not exists created_by text;

update personal_access_tokens set role = 'admin' where role is null;
update personal_access_tokens set created_by = user_id where created_by is null;

alter table personal_access_tokens
    alter column role set not null,
    alter column created_by set not null;

alter table personal_access_tokens drop constraint if exists personal_access_tokens_role_check;
alter table personal_access_tokens
    add constraint personal_access_tokens_role_check
    check (role in ('owner', 'admin', 'marketer', 'analyst', 'billing'));
