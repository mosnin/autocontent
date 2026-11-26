drop trigger if exists decision_log_append_only on decision_log;
drop function if exists decision_log_append_only();
drop index if exists decision_log_point_created_idx;
drop index if exists decision_log_user_created_idx;
drop table if exists decision_log;
