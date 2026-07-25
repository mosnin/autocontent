-- Re-adds the column empty. Prior values are NOT restored — see the
-- forward migration's note.
alter table users add column if not exists ayrshare_profile_key text;
