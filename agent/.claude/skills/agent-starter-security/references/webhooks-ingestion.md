# Webhook ingestion and signed webhooks

## Inbound pipeline (spec: decoupled ingestion → queue → throttled consumer)
```
provider ──POST raw body──▶ createIngestionHandler           (packages/cloudflare/src/ingestion.ts)
   405 non-POST · 413 > maxBodyBytes (256 kB, checked on content-length AND actual length)
   401 verify(raw, request) threw          ← signature over the RAW body (+ method + path with signedDeliveryVerifier), before JSON.parse
   400 INVALID_JSON · 400 CONTRACT_VALIDATION_FAILED {issues}   ← zod schema (cleansing transforms run here)
   401 MISSING_TENANT_ISOLATION_CONTEXT    ← tenantId(payload, request) threw
   429 RATE_LIMITED + retry-after          ← rateLimiter.take(tenantId) (only if a limiter is passed)
   200 { accepted: false, duplicate: true } ← nonceCache hit (only if nonceCache is passed; recorded after a successful enqueue)
   202 { accepted, eventId, sessionKey }   ← queue.send(createEnvelope({... signatureVerified: true }))
   500 { error: "INTERNAL_INGESTION_CRASH", message }  ← anything unexpected (queue send, nonce store, limiter), JSON (spec L2122)
Queue ──batch──▶ processEventBatch (consumer)
   invalid envelope → ack + drop (poison pill) · coalesce per tenant+session (≤ 25 events/turn)
   rate limited → retry(delay) · dispatchTurn ok → ack · dispatch failed → retry(backoff ≤ 300 s) → DLQ after max_retries
```
- The envelope (`EventEnvelopeSchema`) has `id`, `tenantId`, `source`, `type`, `sessionKey`, `receivedAt`, `payload` and `signatureVerified`.
- `eventId(payload)` makes the envelope id `${source}:${providerId}` when the verifier signed the path, else `evt:${providerId}` (the URL `source` is unsigned then). Coalescing dedupes duplicate ids inside a batch.
- `renderTurn(turn)` wraps the session key, types, event ids and every payload in `<untrusted_content>`: an event can't pose as instructions. The consumer's Flue `dispatch` uses `idempotencyKey = sha256(eventIds)`, so a redelivered batch converges.
- The consumer side (dispatch, DLQ, crons) is covered in `agent-starter-background-jobs`.

### Choosing `tenantId`
| Source | OK? |
|---|---|
| A path param signed with `signedDeliveryVerifier` and a **per-tenant secret** | ✅ The tenant is signed and bound to the key that verified it |
| A path param, when the **secret is per tenant** (body-only signature) | ✅ The tenant is bound to the key that verified the body |
| A field inside a payload signed by a per-tenant secret | ✅ |
| A mapping from a verified provider account id (e.g. Manychat `page_id` → tenant via KV) | ✅ |
| A path param with a **global** secret | ⚠️ Anyone holding the global secret can post for any tenant |
| An unverified header or query param | ❌ |

### Contracts
- `ManychatWebhookPayloadSchema`, `ChatMessageEventSchema`, `StripeEventSchema` (`@agent-starter/integrations`).
- `untrustedString(max)` (`@agent-starter/core`) gives a bounded string run through `cleanseUntrustedText`, which:
  - strips control and bidi characters;
  - replaces injection patterns with `[CLEANSED_INJECTION_ATTEMPT]`;
  - truncates.
- Use it for **every** free-text field a third party controls: names, messages, custom field values.

## Signature schemes
| Helper | Scheme |
|---|---|
| `signPayload(secret, body, ts?)` → `{ header: "t=<ts>,v1=<hex>" }` | HMAC-SHA256 hex over `${t}.${body}` |
| `verifySignature(secret \| secret[], body, header, { toleranceSeconds = 300, now })` | Parses every `v1`, accepts any match against any secret, requires `\|now - t\| ≤ tolerance` |
| `verifyRawHmac(secret, body, provided, { encoding: "hex" \| "base64", prefix })` | Plain HMAC of the raw body (Shopify/GitHub-style, e.g. `prefix: "sha256="`) |
| `verifyStripeSignature(secret, raw, header, toleranceSec = 300)` | Stripe `t=,v1=` with numeric `t` checked, any `v1` |

Header names: `SIGNATURE_HEADER = "x-agent-signature"`, `TIMESTAMP_HEADER = "x-agent-timestamp"`.

**Rotation:**
- **Sender side:** during rotation the sender emits two `v1` values, one per secret, so receivers on either secret accept.
- **Receiver side:** pass `[current, previous]`.

`parseSignatureHeader` requires exactly one integer `t` (a non-numeric `t` is rejected instead of comparing as
`NaN` and skipping the window). For internal requests use `signRequest(secret, { method, path, body })` /
`verifySignedRequest(secrets, { method, path, body, header }, { replay })`: the HMAC covers
`METHOD\npath\nbody` (`canonicalRequest`) and `KeyValueReplayGuard` makes each signed request single-use within
the window (the replay key is a hash of the signed content, so padding the header does not dodge it).

**Signed ingestion.** `signedDeliveryVerifier(secrets | (request) => secrets, { header?, toleranceSeconds?, path? })`
is a `verify` for `createIngestionHandler` that checks `signRequest(secret, { method, path, body })` signatures
(path = the request URL's pathname unless `path` is given), with rotation and per-request (per-tenant) secrets.
It returns `{ nonce: "req:<sha256(t + canonical request)>", pathSigned: true }`.

**Webhook nonce cache.** `createIngestionHandler({ nonceCache: { store: new KVStore(env.AGENT_CACHE), ttlSeconds: 900 } })`
answers repeat deliveries `200 { duplicate: true }` without enqueueing. The default nonce uses signed data only:
the verifier's nonce; else `${source}:${tenant}:${eventId}` when the path was signed; else `body:<SHA-256 of the
raw body>`, which is NOT scoped by the URL's tenant or source, so a body-only signature replayed to another tenant,
source or request id is a duplicate. Pass `key` only with a value the signature covers (never an unsigned header).

## Outbound: `WebhookRelay` (`packages/core/src/messaging/relay.ts`)
- `new WebhookRelay({ url, secret, fetch?, outbox?, maxAttempts? = 3, timeoutMs? = 10 000, redact? = true })`.
- `publish(event)` (`TelemetrySink`) and `send(payload, { tenantId, eventId?, eventType?, url? })` set these headers:
  - `x-agent-signature: t=…,v1=…`;
  - `x-agent-timestamp`;
  - `x-agent-signature-v1`;
  - `x-tenant-id`, `x-agent-event-id`, `x-agent-event-type`.
- The body passes through `redactDeep` unless `redact: false`.
- Failures retry with backoff. With `outbox` (a `SqlStore`), they are parked in `as_outbox`. `drainOutbox()` retries them from a cron or alarm and marks a row `DEAD` after 12 attempts.
- **Receivers** (`web/host-routes.example.ts` `handleAgentWebhook`):
  1. Answer 401 when the signature headers are missing; verify the signature over the raw body with `OUTBOUND_WEBHOOK_SECRET` (or `WEBHOOK_SIGNING_SECRET`).
  2. Reject with 400 when `body.tenantId !== x-tenant-id`.
  3. Dedupe on `x-agent-event-id`.

## Tenant config sync (`createTenantSyncRoutes({ kv, secret, replay?, toleranceSeconds? })`)
- `PUT /internal/tenants/:tenantId/config`: the body is the `TenantConfig` JSON. It returns 401 on a bad or reused signature and 400 `CONFIG_INVALID` on a schema failure.
- `DELETE /internal/tenants/:tenantId/config` with an empty body.
- Both verify `x-agent-signature` with `verifySignedRequest` over `METHOD\npath\nbody`, so a captured PUT can't be replayed as a DELETE or against another tenant, and each signed request is accepted once (`replay`, default a `KeyValueReplayGuard` on the same KV under `replay:tenant-sync:`). Sender recipe: `references/recipes.md` §5.
