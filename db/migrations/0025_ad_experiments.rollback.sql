-- Rollback 0025: drop the ads experiments schema.

drop table if exists ad_experiment_arms;
drop table if exists ad_experiments;
