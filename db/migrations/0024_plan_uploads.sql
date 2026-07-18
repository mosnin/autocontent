-- 0024_plan_uploads.sql — plan-first storyboard review + media uploads.
--
-- 'planned': a job that has run ideation + scriptwriting only and is
-- parked for storyboard review before any image/video/TTS spend (see
-- pipeline.run_plan / pipeline.render_from_plan). Mirrors 0004
-- ('skipped') and 0007 ('awaiting_approval') — `alter type ... add
-- value if not exists` in its own migration file, no special
-- non-transactional handling needed: as with those two migrations,
-- Postgres (12+) allows ADD VALUE inside yoyo's per-file transaction as
-- long as the new label isn't *used* in the same transaction, which
-- this file never does.
alter type job_status add value if not exists 'planned';

-- media_assets.source gains 'upload' for user-uploaded library files
-- (POST /api/v1/uploads). Constraint is dropped and re-added rather than
-- altered in place — Postgres has no ALTER CONSTRAINT for check clauses.
alter table media_assets drop constraint media_assets_source_check;
alter table media_assets add constraint media_assets_source_check
    check (source in ('pipeline', 'studio', 'upload'));
