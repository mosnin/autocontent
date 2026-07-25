-- 0028: Drop the Ayrshare profile key.
--
-- Publishing moved to Zernio (0027). Ayrshare addressed a user's accounts
-- through a per-user profile key sent as a header; Zernio addresses them by
-- account id, resolved through social_accounts. Nothing reads this column
-- any more.
--
-- Dropped rather than left in place: a credential-shaped column that no
-- code reads is a liability, not a fallback. The rollback re-adds it as
-- nullable, but the values are not recoverable from here — they lived only
-- in Ayrshare and in this column. If you may return to Ayrshare, dump the
-- column before applying this.
--
-- Apply via the yoyo runner (marketer-migrate up).

alter table users drop column if exists ayrshare_profile_key;
