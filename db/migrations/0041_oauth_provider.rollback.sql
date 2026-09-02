-- Rollback for 0041_oauth_provider.sql.
-- Dropped child-first; the FK cascades would handle it either way.

drop table if exists oauth_tokens;
drop table if exists oauth_authorization_codes;
drop table if exists oauth_grants;
drop table if exists oauth_authorization_requests;
drop table if exists oauth_clients;
