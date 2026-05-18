-- Rollback for 0002_niche_overrides.sql
-- Removes the four columns added to the niches table.
-- PostgreSQL does not support DROP COLUMN IF EXISTS in older versions, but
-- the column-existence check in the forward migration means the column is
-- present if this rollback is needed. Using plain DROP COLUMN is safe here.

alter table niches drop column if exists image_quality;
alter table niches drop column if exists video_resolution;
alter table niches drop column if exists scene_max_duration_sec;
alter table niches drop column if exists tts_style_directions;
