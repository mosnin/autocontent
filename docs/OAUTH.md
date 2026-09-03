# OAuth 2.1 authorization server

marketer.sh can act as an OAuth provider: a third-party application asks a
marketer.sh user for delegated access, the user approves it on a consent
screen, and the application gets an access token.

Three token systems now exist and they do not overlap:

| Caller | Credential | Where it comes from |
|---|---|---|
| The product's own web app | Clerk session JWT | `web/` sign-in |
| The user's own scripts, CLI, MCP | personal access token (`mkt_...`) | `/settings/tokens` |
| **A third-party application** | **OAuth access token (`mko_at_...`)** | **this document** |

## Where it runs, and why

The whole authorization server is the FastAPI app: `backend/routes/oauth.py`
(HTTP), `src/marketer/services/oauth.py` (PKCE, hashing, discovery),
`src/marketer/repos/oauth.py` (storage), migration
`db/migrations/0041_oauth_provider.sql`.

It has to be one surface, because an authorization server needs the human
session and the user table in the same process. This app has both: it
verifies Clerk sessions already, and every grant is a foreign key onto
`users(id)`, which also puts grants inside the existing GDPR export and
erasure cascade.

`web/` contributes routing and nothing else. `web/next.config.js` rewrites
`/oauth/*` and the two `/.well-known` documents to the API, so:

* the public identity stays `https://marketer.sh`, which is what the
  discovery documents advertise and what a browser can actually reach, and
* the consent screen is same-origin with Clerk's `__session` cookie, which
  is how it knows who is signing in.

There is no second implementation in the Next app. If
`NEXT_PUBLIC_API_BASE_URL` is unset the rewrites are simply not installed.

## Endpoints

| Method | Path | Auth | What it does |
|---|---|---|---|
| GET | `/.well-known/oauth-authorization-server` | none | RFC 8414 metadata |
| GET | `/.well-known/oauth-protected-resource` | none | RFC 9728 metadata |
| GET | `/oauth/authorize` | the user's marketer.sh session | validates the request and renders the consent screen |
| POST | `/oauth/authorize` | the same session | records approve or deny, mints the code |
| POST | `/oauth/token` | client (none for public, Basic or POST secret for confidential) | `authorization_code` and `refresh_token` grants |
| POST | `/oauth/revoke` | same as token | RFC 7009 revocation |
| GET | `/oauth/userinfo` | Bearer access token | OIDC-style claims |

An unauthenticated visitor to `/oauth/authorize` is redirected to
`/sign-in?redirect_url=<the same authorize URL>`, signs in, and lands back
on the consent screen with the query intact.

## Scopes

| Scope | What the consent screen says |
|---|---|
| `openid` | Confirm your identity (your marketer.sh user id). |
| `profile` | See your account name, workspace and role. |
| `email` | See the email address on your account. |
| `offline_access` | Stay connected in the background without asking you to sign in again. |
| `content:read` | Read the articles, videos and campaigns in your workspace. |
| `content:write` | Create and update articles, videos and campaigns in your workspace. |

A scope exists only if it has a sentence a human can read; the consent
screen is generated from that table, and a test enforces the correspondence.

Two things worth being exact about:

* `offline_access` is what earns a refresh token. Ask for it or the token
  response has no `refresh_token` in it.
* `content:read` and `content:write` are recorded on the grant, returned in
  the token response and reported by `/oauth/userinfo`, but no resource
  route consumes them yet: the only endpoint that accepts an OAuth access
  token today is `/oauth/userinfo` (which requires `openid`). The
  enforcement primitive is `_require_scope()` in `backend/routes/oauth.py`;
  gating a real route is one call. Existing `/api/v1/*` routes are
  deliberately untouched, because they authenticate Clerk sessions and
  personal access tokens, which belong to the account owner rather than to
  a third party.

## The flow

```bash
# 1. Discovery
curl https://marketer.sh/.well-known/oauth-authorization-server

# 2. Send the user to consent (a browser navigation, not a fetch)
https://marketer.sh/oauth/authorize
  ?response_type=code
  &client_id=mkoc_...
  &redirect_uri=https://acme.example/oauth/callback   # byte-exact
  &scope=openid%20profile%20email%20offline_access%20content:read
  &state=<opaque>
  &code_challenge=<base64url(sha256(verifier))>
  &code_challenge_method=S256
  &resource=https://marketer.sh/api                   # optional, RFC 8707

# 3. The user approves; the browser comes back to
#    https://acme.example/oauth/callback?code=...&state=...&iss=https://marketer.sh
#    (on deny: ?error=access_denied&state=...)

# 4. Exchange the code
curl -X POST https://marketer.sh/oauth/token \
  -d grant_type=authorization_code \
  -d code=mko_ac_... \
  -d code_verifier=<43..128 chars> \
  -d client_id=mkoc_... \
  -d redirect_uri=https://acme.example/oauth/callback

# {"access_token":"mko_at_...","token_type":"Bearer","expires_in":3600,
#  "refresh_token":"mko_rt_...","scope":"openid profile email offline_access content:read"}

# 5. Later, refresh (the old refresh token dies here)
curl -X POST https://marketer.sh/oauth/token \
  -d grant_type=refresh_token -d refresh_token=mko_rt_... -d client_id=mkoc_...

# 6. Claims
curl https://marketer.sh/oauth/userinfo -H "authorization: Bearer mko_at_..."

# 7. Disconnect
curl -X POST https://marketer.sh/oauth/revoke -d token=mko_at_... -d client_id=mkoc_...
```

`/oauth/userinfo` answers with `sub`, `scope`, and, per approved scope,
`name`, `preferred_username`, `org_id`, `org_name`, `roles` (`profile`) and
`email` (`email`). One marketer.sh account is one workspace: every niche,
article, campaign and ledger row hangs off `users.id`, so `org_id` is
`acct_<user id>` and the approver is its `owner`. There is no
`email_verified` claim, because Clerk verifies the address and this app only
keeps a copy: asserting a verification we did not perform would be worse
than omitting it.

## Security properties

* **PKCE is mandatory and `S256` only.** `plain` is refused at authorize.
  The verifier is checked with `hmac.compare_digest`, so a wrong guess
  cannot be walked forward by timing.
* **`redirect_uri` is matched byte for byte**, against the registered list
  at authorize and against the value bound to the code at token. No prefix
  matching, no trailing-slash forgiveness, no default fallback. Until the
  client and the URI are both known good, an error renders a page instead
  of redirecting anywhere.
* **Codes are single use and live ten minutes.** Presenting one twice
  revokes the whole grant, including tokens already issued from it, and
  answers `400 {"error":"invalid_grant", "grant_revoked": true,
  "recovery_status":"authorization_code_replay_revoked"}`.
* **Refresh tokens rotate on every use.** Presenting a rotated one is
  theft, not a retry: the family is revoked and the answer carries
  `recovery_status: "refresh_token_replay_revoked"` plus the `scope` that
  was lost. Rotation is a single UPDATE, so two callers racing with the
  same token cannot both be served.
* **Nothing is stored in plaintext.** Authorization codes, access tokens,
  refresh tokens and client secrets are kept as sha256 hex, like personal
  access tokens. The `_hash` suffix also makes `repos/privacy.py` scrub them
  from the GDPR export automatically.
* **The consent POST cannot be forged.** The GET writes an
  `oauth_authorization_requests` row bound to the signed-in user; the POST
  carries only that row's id plus approve or deny, and the row can be
  claimed once, by that user. No authorization parameter is read back from
  the form, so a cross-site POST can neither approve a request the victim
  never saw nor tamper with its scopes or redirect target.
* **Revocation is idempotent** and always answers `200` with an empty body,
  whether the token was live, already dead, or never existed. Client
  authentication failure is the one exception, per RFC 7009.
* **Grants die with the account.** `oauth_grants.user_id` cascades from
  `users(id)`, so `DELETE /users/me` takes every grant and token with it.

Not implemented, on purpose:

* **No `id_token`.** `openid` is accepted and the claims are served at
  `/oauth/userinfo`, but minting an ID token means running a signing key and
  a JWKS endpoint. Discovery therefore advertises the OAuth metadata
  document, not an OpenID provider configuration.
* **No dynamic client registration** (`/oauth/register`). An open
  registration endpoint lets anyone mint a client and phish this server's
  users with a plausible consent screen. Clients are created deliberately,
  with the script below.

Housekeeping: expired authorization codes and pending consent rows are
inert once they expire (every read filters on `expires_at`), and revoked
tokens are kept so a replay can still be recognised as one. Nothing prunes
them yet; when the tables get large enough to care, a periodic delete of
rows past their expiry is safe.

## Registering a client

```bash
# Public client (a SPA, a CLI, anything that cannot keep a secret). PKCE
# is the only client credential, which is what OAuth 2.1 expects.
python scripts/oauth_client.py create \
  --name "Acme Dashboard" \
  --redirect-uri https://acme.example/oauth/callback \
  --scope openid --scope profile --scope email \
  --scope offline_access --scope content:read

# Confidential client (a server that can hold a secret). The secret is
# printed once and stored only as a hash.
python scripts/oauth_client.py create \
  --name "Acme Server" --redirect-uri https://acme.example/cb --confidential

python scripts/oauth_client.py list
python scripts/oauth_client.py disable --client-id mkoc_...
```

`--name` is what the consent screen shows the user, so it should be the
product's real name. `--redirect-uri` is repeatable and must be `https`
(loopback `http` is allowed for local development); it is stored exactly as
given, because that is exactly how it will be compared. `--scope` is
repeatable and defaults to `openid profile email offline_access
content:read`. A client can never be granted a scope it was not registered
for, no matter what it asks for at authorize time.

The script talks to the same database as the app, so it needs
`MARKETER_DATABASE_URL`, and migration `0041` must be applied
(`marketer-migrate up`).

## Environment

| Variable | Default | What it controls |
|---|---|---|
| `MARKETER_OAUTH_ISSUER` | `MARKETER_APP_URL`, then `https://marketer.sh` | Public origin in the discovery documents and in every absolute URL they advertise. Must be the origin the browser reaches. |
| `MARKETER_OAUTH_RESOURCE` | `<issuer>/api` | RFC 8707 resource indicator. A `resource` parameter must match this (or one registered on the client) and is bound to the code and the grant. |
| `MARKETER_OAUTH_ACCESS_TOKEN_TTL_SECONDS` | `3600` | Access-token lifetime, clamped to 60..86400. |
| `MARKETER_OAUTH_REFRESH_TOKEN_TTL_SECONDS` | `2592000` | Refresh-token lifetime (30 days). Each rotation issues a fresh one. |
| `MARKETER_OAUTH_CODE_TTL_SECONDS` | `600` | Authorization code and pending consent lifetime, clamped to at most ten minutes. |

The server also needs what the rest of the app already needs:
`MARKETER_DATABASE_URL` for storage and `MARKETER_CLERK_JWKS_URL` (plus
`MARKETER_CLERK_ISSUER`) to recognise the session on the consent screen. On
the web side, `NEXT_PUBLIC_API_BASE_URL` is what the `/oauth/*` rewrites
point at. No client secret of ours lives in any of these: a public client
holds only its `client_id`.

## Tests

`tests/test_oauth_service.py` covers the primitives (the RFC 7636 test
vector, verifier bounds, exact URI matching, scope parsing, discovery).
`tests/test_oauth_provider.py` runs the whole flow through the real routes
against an in-memory store: PKCE mismatch refused, code replay revoking the
grant, refresh rotation, refresh replay revoking the family, redirect_uri
mismatch refused at both ends, revocation idempotence, and userinfo
requiring a live token and the `openid` scope.
