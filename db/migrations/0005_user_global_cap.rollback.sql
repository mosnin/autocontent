-- 0004_user_global_cap.rollback.sql — reverses 0004_user_global_cap.sql.
--
-- Apply with:
--   psql "$SUPABASE_DB_URL" -f db/migrations/0004_user_global_cap.rollback.sql

alter table users drop column global_daily_cap_usd;
