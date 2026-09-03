-- 0041: OAuth 2.1 authorization server.
--
-- marketer.sh already authenticates humans (Clerk) and machines the user
-- drives themselves (personal access tokens, 0003). This migration adds the
-- third case: a THIRD-PARTY application asking a marketer.sh user for
-- delegated access, with the user approving it on a consent screen.
--
-- Design notes that are easy to get wrong later:
--
--  * Nothing is stored in plaintext that could be replayed. Authorization
--    codes, access tokens, refresh tokens and client secrets are all kept as
--    sha256 hex of the value we handed out, exactly like personal access
--    tokens. A dump of these tables cannot be used to call the API. The
--    `_hash` suffix is also what makes repos/privacy.py scrub them from the
--    GDPR export automatically -- keep it when adding columns.
--
--  * oauth_authorization_requests is the CSRF defence for the consent
--    screen. The GET validates the request and writes a row bound to the
--    signed-in user; the POST carries only that row's id plus approve/deny.
--    No authorization parameter is ever read back from the submitted form,
--    so a cross-site POST cannot approve a request the victim never saw and
--    cannot tamper with the scopes or the redirect target.
--
--  * A grant is the family. Codes and both token kinds hang off one
--    oauth_grants row, so "revoke everything issued alongside this" (replay
--    detection, RFC 7009 revocation, disconnect) is one update against
--    grant_id rather than a token graph walk.
--
--  * Refresh tokens are single use: rotated_at is stamped when one is
--    exchanged. A rotated token presented again is theft, not a mistake, and
--    kills the whole family.
--
--  * user_id carries the usual FK cascade from users(id), so grants and
--    pending requests are covered by DELETE /users/me erasure and by the
--    data-portability export.

-- ---------------------------------------------------------------------------
-- Registered clients
-- ---------------------------------------------------------------------------

create table if not exists oauth_clients (
    client_id          text primary key,
    name               text not null,
    -- Byte-exact match list. A redirect_uri is accepted only when it equals
    -- one of these strings exactly: no prefix matching, no default fallback.
    redirect_uris      text[] not null,
    scopes             text[] not null,
    -- null = public client (PKCE only, no secret). Non-null = confidential
    -- client that must authenticate at the token endpoint.
    client_secret_hash text,
    -- Optional RFC 8707 resource indicators this client may ask for. Empty
    -- means "the deployment's default resource only".
    resources          text[] not null default '{}',
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    disabled_at        timestamptz
);

drop trigger if exists oauth_clients_updated_at on oauth_clients;
create trigger oauth_clients_updated_at before update on oauth_clients
    for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Pending consent decisions
-- ---------------------------------------------------------------------------

create table if not exists oauth_authorization_requests (
    id                    uuid primary key default gen_random_uuid(),
    user_id               text not null references users(id) on delete cascade,
    client_id             text not null references oauth_clients(client_id) on delete cascade,
    redirect_uri          text not null,
    scopes                text[] not null,
    state                 text not null default '',
    code_challenge        text not null,
    code_challenge_method text not null,
    resource              text not null default '',
    expires_at            timestamptz not null,
    consumed_at           timestamptz,
    created_at            timestamptz not null default now()
);

create index if not exists oauth_auth_requests_user_idx
    on oauth_authorization_requests (user_id);
create index if not exists oauth_auth_requests_expiry_idx
    on oauth_authorization_requests (expires_at);

-- ---------------------------------------------------------------------------
-- Grants (one per approved authorization) and everything issued under them
-- ---------------------------------------------------------------------------

create table if not exists oauth_grants (
    id             uuid primary key default gen_random_uuid(),
    user_id        text not null references users(id) on delete cascade,
    client_id      text not null references oauth_clients(client_id) on delete cascade,
    scopes         text[] not null,
    resource       text not null default '',
    redirect_uri   text not null,
    revoked_at     timestamptz,
    revoked_reason text not null default '',
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

create index if not exists oauth_grants_user_idx on oauth_grants (user_id);
create index if not exists oauth_grants_client_idx on oauth_grants (client_id);

drop trigger if exists oauth_grants_updated_at on oauth_grants;
create trigger oauth_grants_updated_at before update on oauth_grants
    for each row execute function set_updated_at();

create table if not exists oauth_authorization_codes (
    code_hash             text primary key,          -- sha256 hex of the code
    grant_id              uuid not null references oauth_grants(id) on delete cascade,
    code_challenge        text not null,
    code_challenge_method text not null,
    redirect_uri          text not null,
    resource              text not null default '',
    expires_at            timestamptz not null,
    consumed_at           timestamptz,
    created_at            timestamptz not null default now()
);

create index if not exists oauth_codes_grant_idx on oauth_authorization_codes (grant_id);

create table if not exists oauth_tokens (
    id         uuid primary key default gen_random_uuid(),
    grant_id   uuid not null references oauth_grants(id) on delete cascade,
    kind       text not null check (kind in ('access', 'refresh')),
    token_hash text not null unique,               -- sha256 hex of the token
    scopes     text[] not null,
    expires_at timestamptz not null,
    -- Refresh tokens only: stamped when this token is exchanged. Presenting a
    -- rotated token again is replay and revokes the family.
    rotated_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists oauth_tokens_grant_idx on oauth_tokens (grant_id);
create index if not exists oauth_tokens_live_idx on oauth_tokens (grant_id, kind)
    where revoked_at is null;
