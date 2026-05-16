-- 0002_niche_overrides.sql — per-niche overrides for image quality,
-- video resolution / scene duration cap, and TTS style steering.
-- Apply with:
--   psql "$SUPABASE_DB_URL" -f db/migrations/0002_niche_overrides.sql

alter table niches
    add column if not exists image_quality text not null default 'medium'
        check (image_quality in ('low','medium','high'));

alter table niches
    add column if not exists video_resolution text not null default '480p'
        check (video_resolution in ('480p','720p'));

alter table niches
    add column if not exists scene_max_duration_sec int not null default 5
        check (scene_max_duration_sec between 1 and 15);

alter table niches
    add column if not exists tts_style_directions text;
