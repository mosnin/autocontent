-- 0028: let spend that belongs to no playbook be metered and attributed.
--
-- Ad-campaign decision costs (the media buyer's decision-model calls) are
-- real money with no niche: an ad campaign need not be tied to a playbook.
-- The spend ledger must take them, or they are invisible to the global daily
-- cap, to prepaid credit and to the ops spend views.
--
-- 1. spend_ledger.niche_id is nullable. 0022 already dropped the NOT NULL for
--    template remixes; it is restated here because this migration depends on
--    it (DROP NOT NULL is a no-op when already dropped), and because a
--    database restored from a pre-0022 dump would otherwise reject every
--    niche-less row.
-- 2. spend_ledger.ad_campaign_id (nullable) attributes a row to an ad
--    campaign, mirroring job_id / article_id / image_post_id. ON DELETE SET
--    NULL: deleting a campaign must not delete the record of what it cost.
--
-- What a null niche means for the caps:
--   - per-niche daily cap: does not apply (there is no niche to cap);
--   - user global daily cap and prepaid credit: apply as for any other row,
--     because they sum by user_id.
alter table spend_ledger alter column niche_id drop not null;

alter table spend_ledger
    add column if not exists ad_campaign_id uuid references ad_campaigns(id) on delete set null;

create index if not exists spend_ledger_ad_campaign_idx
    on spend_ledger (ad_campaign_id)
    where ad_campaign_id is not null;

-- The global-cap read (sum by user for today) used to ride on
-- spend_user_niche_day_idx (user_id, niche_id, day). With null niches in the
-- mix, give it an index that does not go through niche_id.
create index if not exists spend_user_day_idx
    on spend_ledger (user_id, (cast(created_at at time zone 'UTC' as date)));
