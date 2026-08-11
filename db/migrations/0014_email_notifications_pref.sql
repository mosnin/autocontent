-- 0014: per-user email-notification preference.
--
-- Terminal-state emails (video ready-for-review / scheduled, article done /
-- failed, job failed) are opt-out. Default TRUE so existing users keep the
-- notifications they already receive; a user can silence them from
-- /settings.
--
-- Apply via the yoyo runner (marketer-migrate up), never a raw psql of this
-- single file.

alter table users
    add column email_notifications boolean not null default true;
