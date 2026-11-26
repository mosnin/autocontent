drop trigger if exists tracker_row_history_no_delete on tracker_row_history;
drop trigger if exists tracker_row_history_no_update on tracker_row_history;
drop table if exists tracker_row_history;
drop function if exists tracker_history_append_only();
drop table if exists tracker_views;
drop table if exists tracker_rows;
drop table if exists tracker_fields;
drop table if exists tracker_tables;
