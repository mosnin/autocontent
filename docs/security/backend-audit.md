# Backend security and reliability audit

Scope: the FastAPI backend (`backend/**`), the services and repos it calls (`src/marketer/**`, except the decision
client), and the migrations they depend on. The agent Worker (`agent/`) and the web app (`web/`) are out of scope.

Method: every router mounted in `backend/main.py` was read route by route, then the services each route calls, then
every outbound HTTP call. Findings are ranked by what an attacker (or a fault) gets, not by how hard the fix was.
Every HIGH and MEDIUM finding is fixed, with a test for the fix and for the denied path. What is left open is listed
at the end with the reason.

Tests: `tests/test_backend_security.py` (most findings), `tests/integration/test_pg_spend_nicheless.py` (ledger),
`tests/test_spend_cap.py`, `tests/test_webhooks.py`, `tests/test_webhooks_out.py`, `tests/test_decision_points.py`.

## What was checked and found sound

| Area | Result |
|---|---|
| Auth on every route | All 31 routers require `require_user` or `require_admin`, except the four that must not: `/healthz`, `/healthz/deep`, `POST /billing/webhook` (Stripe signature), `POST /webhooks/ayrshare` (HMAC). |
| Tenant scoping | Every repo call made from a route passes `ctx.user_id`, and the SQL filters on it. Path ids are looked up with `id = $1 and user_id = $2`; a foreign id answers 404. One gap found (M4). |
| Admin routes | `/admin/*`, `/ops/*` and the template write routes depend on `require_admin`. The role is read from the database on every call, never from a token claim. Every admin action is audited. |
| Agent delegation | The service token is compared in constant time. `x-tenant-id` must name an existing user (no account is minted), a suspended tenant gets 403, the role is forced to `user`, and `require_admin` refuses a delegated context even when the tenant is an admin. One escalation path found (H1). |
| Tokens | Personal tokens are stored as SHA-256, shown once, looked up by hash. Failed bearer attempts are throttled per client IP (20 a minute), keyed on the trusted proxy hop. |
| SQL | Every query is parameterised. The dynamic `SET` clauses (niches, kits, templates, ads, users) take column names from a fixed allow-list, never from the request. |
| Mass assignment | Update bodies are explicit pydantic models; repos ignore keys outside their allow-list. `user_id`, `role`, credit balance and status columns cannot be set from a body. |
| Inbound signatures | Stripe: `construct_event` (timestamp tolerance, so replay-bounded) and the credit is idempotent on the session id. Ayrshare: HMAC-SHA256 over the raw body, constant-time compare, 503 when the secret is unset. |
| Outbound signing | Webhooks are signed `t=<ts>,v1=HMAC-SHA256(secret, "<ts>.<body>")`; the secret is returned once at creation. |
| Double approve, double spend | Content approval and rejection are atomic claims (`WHERE status = 'awaiting_approval'`). Ad approvals are decided with an atomic `pending` claim and executed through the rails with an args-bound approval. Credit purchases are unique on the settlement or session id. Spend caps are re-read from the ledger after every write. |
| Uploads | Base64 images are size-bounded, sniffed by magic bytes, written under a server-generated name. Served files come from paths the pipeline wrote, never from request input. Voice ids and preview names are allow-listed. |

## Findings

### HIGH

**H1. The agent could turn delegation into a standing admin credential, and erase accounts.** *Fixed.*
The service token plus `x-tenant-id` acts as any tenant with `role="user"`. But `POST /api/v1/tokens` was open to it,
and a personal token carries the tenant's *stored* role. Minting a token for an admin tenant gave a long-lived admin
bearer, which is exactly what the delegation contract forbids. `DELETE /api/v1/users/me` (irreversible erasure) and
`GET /api/v1/users/me/export` (full account dump) were open to it too, so a leaked service token could erase or dump
every tenant.
Fix: `backend/security.py::require_person` refuses a delegated context (403) on all three token routes, on erasure
and on export.

**H2. The failures inbox could post the same content twice.** *Fixed.*
`POST /jobs/{id}/retry` and `POST /image-posts/{id}/retry` refuse while an earlier post of the item has an unknown
outcome nobody resolved. `POST /api/v1/failures/replay/{kind}/{id}` is the same retry by another address and skipped
that check.
Fix: the replay route calls `rails.assert_no_unresolved` for jobs and image posts (409 `outcome_unknown`).

**H3. Spending limits and the approval gate could be loosened outside the enforcement point.** *Fixed (known gap 1).*
`PUT /niches/{id}` (daily spend cap, `approve_before_post`), `PATCH /users/me` (global daily cap) and `PUT /brand-kit`
wrote straight to the database: no kill switch, no record, no idempotency key, and the agent could remove the approval
gate or the account's global cap.
Fix: seven registered HIGH actions (`src/marketer/rails/actions.py`), dispatched from the three routes. The route reads
the stored value and dispatches what the change amounts to; raising and lowering are separate actions so a kill switch
stops a raise and never a tightening. The agent is refused (403) when it tries to remove the approval gate or to raise
or remove the global cap. See `docs/rails/enforcement-point.md`.

### MEDIUM

**M1. No limit on request bodies.** *Fixed.*
Any JSON route buffered whatever a client sent, and string fields without `max_length` were stored as sent.
Fix: `BodySizeLimitMiddleware` (1 MiB by default, 12 MiB for the template image routes, 64 KiB for the decision log).
It reads the body itself, so a chunked upload with no `Content-Length` stops at the same limit. Unbounded strings,
lists and numbers on niches, campaigns, kits, templates, articles, image posts, ads and brand kit now have bounds
(a `scene_count` of 10,000 or a cap that overflows `numeric(8,2)` is a 422, not a paid run or a 500).

**M2. Expensive endpoints had no per-account limit; all agent traffic shared one bucket.** *Fixed (known gap 3).*
The only limit was 600 a minute per client IP. One account could queue paid pipeline runs, remixes and model calls in a
loop (`POST /niches/draft` is an unmetered model call), and `POST /decisions/log` could be flooded. Every agent call
leaves from one egress, so one busy tenant throttled all of them.
Fix: `user_rate_limit` (per authenticated tenant, same storage as slowapi) on the routes that spawn work or call a
provider, including `decisions/log` (300 a minute per tenant) and the new outcome route. Verified agent calls are
bucketed per tenant; the header picks a bucket only when the bearer is the real service token.

**M3. Webhook delivery could be pointed at internal addresses by DNS rebinding.** *Fixed.*
The URL was checked, then the HTTP client resolved the name again. A hostile DNS server answers the check with a public
address and the connection with `169.254.169.254`. The guard also missed carrier-grade NAT, IPv4-mapped IPv6, the IPv6
metadata address, URLs with credentials, and a trailing-dot metadata hostname.
Fix: `ssrf.resolve_public_url` returns the vetted address and delivery connects to it (`pinned_target`), keeping the
hostname for SNI, certificate verification and the Host header. Redirects are not followed. Endpoints are capped at 20
per account and test sends are rate limited, so the feature is not a request cannon.

**M4. An ad campaign could be attached to another tenant's playbook.** *Fixed.*
`POST /ads/campaigns` checked the ad account's owner but stored `niche_id` from the body unchecked.
Fix: the niche must belong to the caller (404 otherwise).

**M5. `/healthz/deep` told anyone how the deployment is wired.** *Fixed.*
It has no auth and returned raw exception text: a driver error carries the database host, user and database name.
Fix: the response carries the exception class; the text goes to the log. The same was done for provider error text
returned by `/niches/draft`, `/voices/{voice}/preview`, the Stripe webhook and checkout, and composition errors.

**M6. No security headers.** *Fixed.*
Fix: `SecurityHeadersMiddleware` adds `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HSTS and
`Cross-Origin-Resource-Policy` everywhere, and `Cache-Control: no-store` plus a deny-all CSP on JSON (responses carry
tenant data and one-time secrets).

**M7. A captured Ayrshare delivery could be replayed forever.** *Fixed.*
The signature covers the body only, with no timestamp. A replayed `errored` event marks a posted job failed, and a
retry then posts it again. A delivery with an empty post id matched any job whose stored id was empty.
Fix: each delivery is claimed by the hash of its body (`idempotency_keys`, 30 days); a repeat is answered 200 and
ignored. A failed apply releases the claim so the provider's own retry lands. Empty ids are ignored.

**M8. x402 settlement: a lost answer became a 500, with the payer possibly charged.** *Fixed.*
A timeout or 5xx from the facilitator's `/settle` raised out of the route. Credit was also rounded half-even, so a
payment could be credited a fraction of a cent above what was paid.
Fix: `X402FacilitatorError` separates verify (nothing charged, 502) from settle (502 `outcome_unknown:`, logged with
the payer, one attempt, no credit). `from_atomic` rounds down. The Stripe webhook now refuses to credit an amount
outside the pack range.

**M9. Outbound calls: missing timeouts, retries on calls that are not reads.** *Fixed (known gap 4).* See the next
section.

**M10. `spend_ledger` could not meter small or niche-less costs.** *Fixed (known gap 2).*
`cost_usd` was `numeric(10,4)`: a decision call of about $0.00002 was stored as 0.0000, so no cap ever saw it. A
`SpendContext` with no niche compared its per-niche cap against an empty sum.
Fix: migration `0028` (with rollback): `cost_usd numeric(14,8)`, `niche_id` nullable (restated; 0022 dropped it),
`ad_campaign_id` for attribution, an index for the per-user daily sum. Niche-less spend is metered against the global
cap and prepaid credit; only the per-niche cap is skipped. Every reader of the column was run against niche-less and
sub-cent rows.

### LOW

| # | Finding | State |
|---|---|---|
| L1 | Admin flag list was not audited; flag keys accepted any characters; list limits on `/ads/actions` accepted negatives (a 500). | Fixed |
| L2 | The article download header took the model-written slug unescaped. | Fixed |
| L3 | Composio SDK calls ran on the event loop with no deadline; an agent run had no deadline. | Fixed |
| L4 | Stripe checkout ran a blocking call on the event loop with the library's 80 s default. | Fixed |
| L5 to L12 | See "Left open". | Open |

## Outbound calls

The rule (`src/marketer/services/retry_policy.py`):

1. **Every call has an explicit timeout.**
2. **An idempotent read** (a status poll, a download, an analytics GET) is retried on transient failures.
3. **A request that creates something on the other side** is retried only when the first attempt provably never
   reached the provider (connect failure, connect or pool timeout) or was refused (429).
4. **A send that publishes or moves money** is never retried. It runs through `marketer.rails`, and an unanswered
   attempt is recorded as an unknown outcome for a person to resolve.

| Call | Timeout | Retry | Change |
|---|---|---|---|
| Clerk JWKS (`backend/auth.py`) | 5 s | none (keys cached) | was the library's 30 s default |
| Stripe checkout | 20 s | none | off the event loop; was 80 s default |
| Stripe / Ayrshare inbound | n/a | n/a | n/a |
| Webhook delivery | 10 s (5 s connect) | none; no redirects | pinned address |
| x402 verify / settle | 15 s / 45 s | none | settle failure is an unknown outcome |
| Ayrshare `POST /post` (publish) | 60 s | none, through rails `content.post.send` | unchanged, documented |
| Ayrshare media upload | 60 s | transient only (an upload publishes nothing) | no longer retries a 4xx |
| Ayrshare create profile | 30 s | unsent or 429 only | was any transport error |
| Ayrshare login URL, analytics | set | reads | unchanged |
| Grok video submit | 60 s | unsent or 429 only | was any HTTP error, 4xx included |
| Fal video submit | 60 s | unsent or 429 only | was transport, 429 and 5xx |
| Grok / Fal poll and download | 60 s | reads | Grok no longer retries a 4xx |
| OpenAI TTS, images, Whisper | 120 to 180 s | tenacity only | SDK default was 600 s and 2 extra retries on top |
| OpenRouter, article LLM | 120 s / 300 s | SDK, 2 | timeout was the 600 s default |
| Agents SDK run | 600 s for the whole run | SDK | had no run deadline |
| ElevenLabs TTS and music, Pixabay, Exa, Resend | already set | see L5 | unchanged |
| Wasabi (boto3) | 10 s connect, 120 s read | 3, fixed-key writes | were botocore defaults |
| Composio connect, status, disconnect | 20 s | none | were unbounded and on the event loop |
| Ad platform changes | SDK | none, through rails | unchanged |

## Left open, and why

| # | Finding | Why it is open |
|---|---|---|
| L5 | Synchronous generation calls (OpenAI TTS, images, Whisper; ElevenLabs TTS and music) still retry after a read timeout, so a call that completed on the provider's side can be paid for twice. | Nothing is published and the duplicate is cents, bounded by the spend cap's post-write check. Stopping the retry would fail every job that hits a provider blip. This is a product trade-off: needs a decision. |
| L6 | A Modal `spawn` has no timeout, and a failed spawn on the enqueue routes leaves a `queued` row. | Modal's client exposes no deadline for `spawn`. The approve paths already run through the rails; the stale-row reaper (120 min) covers the rest. |
| L7 | Webhook signing secrets are stored in plaintext. | They must be readable to sign; hashing is not possible. Encrypting them at rest needs a key-management decision. |
| L8 | `/docs` and `/openapi.json` are served without auth. | The API surface is not secret, and turning them off changes how clients are generated. A deploy decision. |
| L9 | With `MARKETER_WEB_ORIGIN` unset, CORS falls back to `*` without credentials. | Auth is a bearer header, so a foreign origin cannot ride a session. The app logs a warning at boot. Refusing to start without it is a deploy decision. Not widened, not narrowed here. |
| L10 | Rate-limit state is per process unless `MARKETER_RATE_LIMIT_REDIS_URL` is set. | Configuration, not code: with several instances each keeps its own buckets. Set the Redis URL in production. |
| L11 | `ads.account.governance` is one action for loosening and tightening, so the global kill switch also blocks turning an ad account's own kill switch on. | Splitting it changes an action the agent registry names; it belongs with the rails owners. |
| L12 | Credit transactions (`numeric(10,4)`) and the pricing helpers still work in four decimals, so hosted billing debits a sub-cent decision call as zero even though the ledger now records it. | Outside migration 0028's table; widening the credit ledger changes billing arithmetic and needs its own migration and review. |
| L13 | `POST /connect/ayrshare` returns the Ayrshare profile key to the browser. | The key alone posts nothing (the API key is also required) and the existing clients read it. Removing it is an API change. |
| L14 | The Ayrshare replay guard covers 30 days; an older captured delivery would be applied again. | Ayrshare's signature has no timestamp to check. Accepted: it needs both a captured signed body and a month. |

## Not verified here

- No live call was made to Stripe, Ayrshare, Composio, Modal, the x402 facilitator, OpenAI, Fal, xAI or ElevenLabs.
  Their behaviour is tested against fakes.
- Pinned webhook delivery was verified against a local TLS server (certificate checked against the hostname, wrong
  name refused). It was not verified against a public host: the sandbox proxy refuses a CONNECT to an IP literal.
- The Redis-backed limiter was not exercised; the per-tenant limits were tested on in-memory storage.
