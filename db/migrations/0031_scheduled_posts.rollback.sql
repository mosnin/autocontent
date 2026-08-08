-- Children first: scheduled_post_variants FKs scheduled_posts, which FKs
-- recurring_slots. Triggers and indexes are dropped with their tables, but
-- the fill function is standalone so it needs an explicit drop.
--
-- NOTE: this destroys the only record of what was published to a user's
-- real social accounts (provider_post_id per platform). Those posts stay
-- live on the platforms — rolling back does not un-post anything, it just
-- makes it invisible here. Export before rolling back in production.
--
-- set_updated_at() is owned by 0001 and shared with every other table;
-- it is deliberately NOT dropped here.
drop table if exists scheduled_post_variants;
drop table if exists scheduled_posts;
drop table if exists recurring_slots;
drop function if exists scheduled_post_variant_user_id();
