-- Rollback for 0003_personal_access_tokens.sql
-- Drops the personal_access_tokens table and its index.

drop index if exists pat_user_idx;
drop table if exists personal_access_tokens;
