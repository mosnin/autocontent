drop index if exists cannibalization_findings_user_idx;
drop table if exists cannibalization_findings;

drop index if exists article_audits_article_idx;
drop index if exists article_audits_user_idx;
drop table if exists article_audits;

drop index if exists content_cluster_items_article_idx;
drop index if exists content_cluster_items_cluster_idx;
drop table if exists content_cluster_items;

drop index if exists content_clusters_niche_idx;
drop index if exists content_clusters_user_idx;
drop table if exists content_clusters;
