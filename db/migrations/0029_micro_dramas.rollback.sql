drop trigger if exists micro_dramas_updated_at on micro_dramas;
drop index if exists micro_dramas_stale_idx;
drop index if exists micro_dramas_niche_idx;
drop index if exists micro_dramas_user_status_idx;
drop index if exists micro_dramas_user_created_idx;
drop table if exists micro_dramas;
