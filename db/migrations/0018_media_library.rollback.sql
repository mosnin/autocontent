alter table spend_ledger alter column niche_id set not null;
drop index if exists media_assets_kind_idx;
drop index if exists media_assets_user_created_idx;
drop table if exists media_assets;
