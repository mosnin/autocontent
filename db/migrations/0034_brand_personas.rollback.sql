-- Rollback 0034. Messages first: brand_persona_messages FKs into
-- brand_personas, so dropping the parent first would fail on any database
-- that ever held a conversation.
drop index if exists brand_persona_messages_user_idx;
drop index if exists brand_persona_messages_thread_idx;
drop table if exists brand_persona_messages;

drop index if exists brand_personas_niche_idx;
drop index if exists brand_personas_user_idx;
drop table if exists brand_personas;
