-- Rollback for 0026_pat_scopes.sql
-- Drops the scopes column and its validity constraint.

alter table personal_access_tokens
    drop constraint if exists personal_access_tokens_scopes_valid;

alter table personal_access_tokens
    drop column if exists scopes;
