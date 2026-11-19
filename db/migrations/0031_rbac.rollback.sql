-- Rollback of 0031. Drops the security audit log (its rows are lost) and the
-- token role columns (every token goes back to acting with the tenant's
-- stored role). Run only together with the backend version before 0031.
alter table personal_access_tokens drop constraint if exists personal_access_tokens_role_check;
alter table personal_access_tokens
    drop column if exists created_by,
    drop column if exists role;

drop trigger if exists security_audit_log_no_truncate on security_audit_log;
drop trigger if exists security_audit_log_no_update on security_audit_log;
drop table if exists security_audit_log;
drop function if exists security_audit_log_append_only();
