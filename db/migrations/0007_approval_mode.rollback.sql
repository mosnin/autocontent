-- Postgres cannot drop a value from an enum type; removing
-- 'awaiting_approval' would require rebuilding the type. The column is
-- reversible.
alter table niches drop column if exists approve_before_post;
