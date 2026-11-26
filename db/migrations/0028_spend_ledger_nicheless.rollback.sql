-- niche_id stays nullable on rollback: restoring NOT NULL would fail on (or
-- force the deletion of) niche-less rows, and spend history is never deleted
-- to make a schema change fit. 0022's rollback makes the same choice.
drop index if exists spend_user_day_idx;
drop index if exists spend_ledger_ad_campaign_idx;
alter table spend_ledger drop column if exists ad_campaign_id;
-- Back to four decimals. Postgres rounds each value (half away from zero), so
-- sub-cent costs recorded while 0028 was applied are rounded, not rejected:
-- the same loss the narrow column imposed before, never an error.
alter table spend_ledger alter column cost_usd type numeric(10, 4);
