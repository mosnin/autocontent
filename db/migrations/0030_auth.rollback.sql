-- Rollback 0030: drop Better Auth's schema and everything in it. This signs
-- everyone out and deletes every workspace membership; product data in
-- `public` is untouched.
drop schema if exists auth cascade;
