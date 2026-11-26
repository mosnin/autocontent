-- 0034: invite and pilot access codes (docs/billing/access-codes.md).
--
-- 1. access_codes: codes Marketer staff hand out. Only a sha256 of the
--    normalized code is stored (code_hash), never the code itself; code_hint
--    is its last four characters, so staff can tell codes apart in a list.
--    kind is 'invite' or 'pilot'. A code grants credit_usd (through the
--    credit ledger) and/or trial_days (a pilot window shown to the
--    workspace). max_redemptions bounds how many workspaces may use it;
--    redemption_count is maintained in the same transaction as each
--    redemption, under a row lock, so it can never exceed the maximum.
-- 2. access_code_redemptions: one row per (code, workspace), ever. The unique
--    key is what makes a redemption idempotent: a retry or a second click can
--    never grant twice. tenant_id is the workspace's tenant id (users.id).
-- 3. credit_tx_code_grant_ref_idx: one ledger grant per redemption, as a
--    second guard under the unique key above.

create table if not exists access_codes (
    id               uuid primary key default gen_random_uuid(),
    code_hash        text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
    code_hint        text not null check (length(code_hint) between 1 and 8),
    kind             text not null check (kind in ('invite', 'pilot')),
    credit_usd       numeric(10, 4) not null default 0 check (credit_usd >= 0 and credit_usd <= 1000),
    trial_days       integer check (trial_days is null or trial_days between 1 and 365),
    max_redemptions  integer not null default 1 check (max_redemptions between 1 and 100000),
    redemption_count integer not null default 0 check (redemption_count >= 0),
    expires_at       timestamptz,
    disabled_at      timestamptz,
    note             text not null default '' check (length(note) <= 200),
    created_by       text not null check (length(created_by) between 1 and 256),
    created_at       timestamptz not null default now(),
    check (credit_usd > 0 or trial_days is not null),
    check (redemption_count <= max_redemptions)
);
create index if not exists access_codes_created_idx on access_codes (created_at desc);

create table if not exists access_code_redemptions (
    id           uuid primary key default gen_random_uuid(),
    code_id      uuid not null references access_codes(id) on delete restrict,
    tenant_id    text not null references users(id) on delete cascade,
    actor_id     text not null check (length(actor_id) between 1 and 256),
    kind         text not null check (kind in ('invite', 'pilot')),
    credit_usd   numeric(10, 4) not null default 0,
    access_until timestamptz,
    redeemed_at  timestamptz not null default now(),
    unique (code_id, tenant_id)
);
create index if not exists access_code_redemptions_tenant_idx on access_code_redemptions (tenant_id, redeemed_at desc);

create unique index if not exists credit_tx_code_grant_ref_idx
    on credit_transactions (reference) where kind = 'grant' and reference like 'access-code:%';

comment on table access_codes is
    'Invite and pilot codes (docs/billing/access-codes.md). Stores a sha256 of the code, never the code.';
