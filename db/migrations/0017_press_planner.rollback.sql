alter table niches drop column if exists articles_per_week;

drop index if exists articles_scheduled_idx;
alter table articles drop column if exists serp_analysis;
alter table articles drop column if exists scheduled_at;

drop index if exists article_publishes_target_idx;
drop index if exists article_publishes_article_idx;
drop table if exists article_publishes;

drop index if exists publish_targets_user_idx;
drop table if exists publish_targets;

drop index if exists topic_proposals_approved_idx;
drop index if exists topic_proposals_pending_idx;
drop index if exists topic_proposals_user_idx;
drop table if exists topic_proposals;
