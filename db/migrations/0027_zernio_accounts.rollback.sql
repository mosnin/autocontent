drop index if exists social_accounts_user_platform_idx;
drop index if exists social_accounts_zernio_account_idx;
drop table if exists social_accounts;
alter table users drop column if exists zernio_profile_id;
