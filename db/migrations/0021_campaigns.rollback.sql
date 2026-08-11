alter table jobs drop column if exists campaign_id;
alter table articles drop column if exists campaign_id;
drop table if exists campaign_items;
drop table if exists campaigns;
