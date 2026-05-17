-- 0004_user_global_cap.sql — per-user global daily spend cap.
--
-- NULL means "no global cap". Default left NULL on purpose so existing
-- users opt-in by setting a value.
--
-- Apply with:
--   psql "$SUPABASE_DB_URL" -f db/migrations/0004_user_global_cap.sql

alter table users add column global_daily_cap_usd numeric(10, 2);
