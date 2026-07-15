drop trigger if exists feature_flags_updated_at on feature_flags;
drop table if exists feature_flags;
drop table if exists admin_audit_log;
alter table users
    drop column if exists suspended_reason,
    drop column if exists suspended_at,
    drop column if exists role;
drop type if exists user_role;
