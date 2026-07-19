-- 0026_pat_scopes.sql — scoped personal access tokens.
--
-- Adds a `scopes` column to personal_access_tokens so API/agent credentials
-- can be issued with least-privilege grants instead of implicit full access.
--
-- Scope vocabulary (deliberately coarse — three tiers, no per-resource
-- scopes yet):
--   read  - any GET (list/read endpoints)
--   write - create/mutate content: niches, jobs, articles, campaigns,
--           image-posts, templates, kits, and similar mutating routes
--   admin - admin-only routes (requires role='admin' on top of this)
--
-- Backward compatibility: every existing token predates scoping and was
-- usable for both reads and writes, so the column defaults to
-- '{read,write}' — no previously-issued token loses access. Admin access
-- was never implicitly granted to a PAT (routes already gate on the
-- owning user's role), so omitting 'admin' from the default changes
-- nothing in practice.
--
-- Apply with:
--   psql "$MARKETER_DATABASE_URL" -f db/migrations/0026_pat_scopes.sql

alter table personal_access_tokens
    add column if not exists scopes text[] not null default '{read,write}';

-- Fail closed at the DB layer too: only the three known scopes may ever be
-- stored, so a bug upstream can't silently grant an unrecognised capability.
alter table personal_access_tokens
    add constraint personal_access_tokens_scopes_valid
    check (scopes <@ array['read', 'write', 'admin']::text[]);
