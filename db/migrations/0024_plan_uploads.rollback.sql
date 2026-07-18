-- Postgres cannot drop a value from an enum type (same limitation
-- documented in 0004's and 0007's rollback files); 'planned' stays
-- defined permanently once applied. Only the check constraint is
-- reversible.
alter table media_assets drop constraint media_assets_source_check;
alter table media_assets add constraint media_assets_source_check
    check (source in ('pipeline', 'studio'));
