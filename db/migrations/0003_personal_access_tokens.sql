-- 0003_personal_access_tokens.sql — long-lived API tokens for CLI / MCP / agent use.
--
-- A user generates a token in the web UI; the plaintext is shown ONCE and
-- never re-stored. Backend auth recognises any bearer that starts with
-- "act_" as a PAT and looks it up by sha256(plaintext).
--
-- Apply with:
--   psql "$SUPABASE_DB_URL" -f db/migrations/0003_personal_access_tokens.sql

create table if not exists personal_access_tokens (
    id              uuid primary key default gen_random_uuid(),
    user_id         text not null references users(id) on delete cascade,
    name            text not null,
    token_hash      text not null unique,          -- sha256 hex of the plaintext token
    prefix          text not null,                 -- "act_" + first 4 chars (display only)
    last_used_at    timestamptz,
    created_at      timestamptz not null default now(),
    expires_at      timestamptz,
    revoked_at      timestamptz
);

create index if not exists pat_user_idx on personal_access_tokens(user_id) where revoked_at is null;
