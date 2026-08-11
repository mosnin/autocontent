-- Rollback 0014: drop the email-notification preference column.

alter table users drop column if exists email_notifications;
