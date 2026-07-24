drop index if exists spend_ledger_studio_generation_idx;
alter table spend_ledger drop column if exists studio_generation_id;
drop table if exists studio_generations;
