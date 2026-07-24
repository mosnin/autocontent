-- 0027: Zernio publishing — per-user profile plus the account map.
--
-- Ayrshare scoped every call with a per-user `Profile-Key` header, so
-- "whose accounts" was implicit in the transport and one column on users
-- was enough. Zernio addresses accounts by id in the request body, and
-- per its own docs an accountId is validated against the whole TEAM, not
-- against a profile. Passing one tenant another tenant's account id would
-- publish to the wrong customer's socials and Zernio would accept it.
--
-- So ownership has to live here, scoped by user_id, and every publish
-- resolves its targets through this table. The profile id stays on users
-- because it is one per user and is what the connect flow needs; the
-- accounts are a table because a user connects several and each has its
-- own lifecycle (connected, disconnected, reconnected).
--
-- Rows are written from the `account.connected` webhook and reconciled
-- against GET /v1/accounts, because webhooks are at-least-once and can be
-- missed entirely.
--
-- Apply via the yoyo runner (marketer-migrate up).

alter table users add column if not exists zernio_profile_id text;

create table if not exists social_accounts (
    id                  uuid primary key default gen_random_uuid(),
    user_id             text not null references users(id) on delete cascade,
    -- Zernio's account id; the value sent as platforms[].accountId.
    zernio_account_id   text not null,
    -- The profile it belongs to, mirrored for reconciliation and support.
    zernio_profile_id   text not null,
    -- OUR platform name: 'tiktok' | 'reels' | 'shorts'.
    platform            text not null,
    -- Display handle, for the connect UI. Best-effort, never a key.
    username            text not null default '',
    -- False once Zernio reports the token dead (account.disconnected).
    -- Disconnected rows are KEPT: published posts reference them, and the
    -- user reconnects into the same row rather than a duplicate.
    is_active           boolean not null default true,
    connected_at        timestamptz not null default now(),
    disconnected_at     timestamptz,
    updated_at          timestamptz not null default now()
);

-- One row per Zernio account, globally. This is the constraint that makes
-- the webhook handler safe to run twice: an at-least-once redelivery
-- upserts instead of creating a second row.
create unique index if not exists social_accounts_zernio_account_idx
    on social_accounts (zernio_account_id);

-- The publish-path lookup: "this user's live accounts for this platform".
create index if not exists social_accounts_user_platform_idx
    on social_accounts (user_id, platform) where is_active;
