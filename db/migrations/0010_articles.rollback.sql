drop index if exists spend_ledger_article_idx;
alter table spend_ledger drop column if exists article_id;
drop trigger if exists articles_updated_at on articles;
drop table if exists articles;
drop type if exists article_status;
