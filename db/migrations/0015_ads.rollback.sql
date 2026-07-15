-- Rollback 0015: drop the Ads product schema (children first, though the FK
-- cascades would handle it — explicit for clarity).

drop table if exists ad_approvals;
drop table if exists ad_actions_log;
drop table if exists ad_metrics_daily;
drop table if exists ad_creatives;
drop table if exists ad_sets;
drop table if exists ad_campaigns;
drop table if exists ad_accounts;
