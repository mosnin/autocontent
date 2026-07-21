# Authentication

The API accepts a Bearer token on every request (except a couple of intentionally-open routes like `/healthz`):

```
Authorization: Bearer <token>
```

Two token shapes are accepted (`backend/auth.py::require_user`):

| Prefix | What it is | Who uses it |
|---|---|---|
| `mkt_...` | A personal access token (PAT) | CLI, MCP server, the TypeScript/Python SDKs, any external script/agent |
| anything else | A Clerk session JWT (RS256, verified against Clerk's JWKS) | The web dashboard, via the logged-in browser session |

**Use a PAT for anything programmatic.** JWTs are short-lived, tied to a browser session, and not meant to be copy-pasted into scripts or `.env` files.

## Creating a personal access token

You need an existing authenticated session (the web dashboard) to mint the *first* PAT — after that, PATs can create more PATs.

```bash
curl -X POST https://api.marketer.sh/api/v1/tokens \
  -H "Authorization: Bearer <existing-token-or-session-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"name": "my laptop", "expires_in_days": 90}'
```

Response (`201 Created`):

```json
{
  "token": "mkt_9c2f...redacted...",
  "info": {
    "id": "b6f2...",
    "name": "my laptop",
    "created_at": "2026-07-19T12:00:00Z",
    "expires_at": "2026-10-17T12:00:00Z",
    "last_used_at": null
  }
}
```

**The plaintext `token` field is shown exactly once.** Only a sha256 hash is stored server-side — if you lose it, revoke it (`DELETE /api/v1/tokens/{token_id}`) and mint a new one. Store it like any other credential (secret manager, `.env` excluded from version control, OS keychain) — never commit it.

List and revoke tokens:

```bash
curl https://api.marketer.sh/api/v1/tokens -H "Authorization: Bearer $MARKETER_API_TOKEN"
curl -X DELETE https://api.marketer.sh/api/v1/tokens/<token_id> -H "Authorization: Bearer $MARKETER_API_TOKEN"
```

`POST /api/v1/tokens` is rate-limited to 5/minute per caller; `GET` (list) to 30/minute.

## Scopes

PATs carry a `scopes` grant: `read`, `write`, and/or `admin` (`backend/auth.py`, `db/migrations/0026_pat_scopes.sql`). Request one or more when creating a token:

```bash
curl -X POST https://api.marketer.sh/api/v1/tokens \
  -H "Authorization: Bearer $MARKETER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "read-only reporting bot", "scopes": ["read"]}'
```

- Omit `scopes` entirely to get the backward-compatible default: `["read", "write"]` — existing integrations minted before scoping shipped keep working unchanged.
- Routes generally enforce scope-by-HTTP-method: `GET`/`HEAD`/`OPTIONS` require `read`; mutating verbs require `write`. A few routes (e.g. admin endpoints) additionally require `admin` regardless of method.
- A **Clerk-JWT (web session) caller is always unscoped** — full account access, exactly as before scoping existed. Scoping only constrains PATs.
- An unknown scope name in the request (anything outside `read`/`write`/`admin`) is rejected with `400 bad_request` at token-creation time — you cannot silently mint a token with a typo'd, no-op scope.
- A token's scopes are fixed at creation and never widened later — to change what a token can do, revoke it and mint a new one with the scopes you want.

A PAT lacking a required scope gets `403 forbidden` with a message naming the missing scope (e.g. `"token is missing required scope: 'write'"`) — distinguishable from the generic `403` an unauthorized *user* (rather than an under-scoped *token*) would get, via that message text (there is currently one shared `forbidden` code for both; branch on the message if you need to tell them apart programmatically, or treat any `403` as "not permitted" and prompt for a differently-scoped token).

Mint a separate token per integration/machine with only the scopes it needs (e.g. `["read"]` for a reporting dashboard, full `["read","write"]` only for something that actually enqueues jobs) so you can revoke blast-radius independently and limit what a leaked token can do.

## Failure modes

| Status | `error.code` | Meaning |
|---|---|---|
| 401 | `unauthorized` | Missing bearer token, malformed token, expired/revoked PAT, or invalid/expired JWT |
| 403 | `forbidden` | Valid token, but the account is suspended, the action requires `admin` role, or (PAT only) the token is missing a required scope (`read`/`write`/`admin`) |
| 429 | `rate_limited` | Too many failed auth attempts from this IP (20/minute) — a brute-force guard, independent of the per-route rate limits above |

See [`errors.md`](./errors.md) for the full envelope shape.
