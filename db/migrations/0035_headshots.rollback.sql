-- Children first: headshot_variants FKs headshot_batches.
-- Indexes go with their tables, so dropping the tables is sufficient.
--
-- NOTE: this drops the only record of which files on the artifacts
-- volume hold user-uploaded source photographs. Run
-- `marketer.headshots.pipeline.purge_user_files` (or clear
-- <artifacts_dir>/users/*/headshots*) before rolling back if the
-- deployment is being decommissioned rather than reshaped.
drop table if exists headshot_variants;
drop table if exists headshot_batches;
drop table if exists headshot_sources;
