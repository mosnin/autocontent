-- niche_id stays nullable on rollback: restoring NOT NULL could fail on data.
alter table spend_ledger drop column if exists image_post_id;
alter table campaign_items drop constraint if exists campaign_items_kind_check;
alter table campaign_items
    add constraint campaign_items_kind_check
    check (kind in ('video', 'article', 'ad'));
drop table if exists templates;
drop table if exists image_posts;
