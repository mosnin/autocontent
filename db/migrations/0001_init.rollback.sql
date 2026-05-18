-- Rollback for 0001_init.sql
-- Drops all objects created by the initial schema migration, in reverse
-- dependency order (triggers → functions → indexes → tables → types → extensions).

drop trigger if exists jobs_updated_at on jobs;
drop function if exists set_updated_at();

drop index if exists spend_user_niche_day_idx;
drop index if exists jobs_niche_created_idx;
drop index if exists jobs_user_status_idx;
drop index if exists niches_user_idx;

drop table if exists spend_ledger;
drop table if exists jobs;
drop table if exists niches;
drop table if exists users;

drop type if exists job_status;

drop extension if exists pgcrypto;
