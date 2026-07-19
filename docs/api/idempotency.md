# Idempotency

For any mutating request (`POST`/`PUT`/`PATCH`/`DELETE`) that spends money, spawns a pipeline run, or otherwise has a side effect you can't cheaply undo, send an `Idempotency-Key` header:

```
Idempotency-Key: <a UUID you generate once per logical operation>
```

**Generate the key once per logical operation, then reuse the exact same value on every retry of that operation** (network timeout, 5xx, connection reset). A *new* logical operation — the user clicking "enqueue" a second time, on purpose — must get a *new* key. Getting this wrong in either direction is bad: reusing a key across genuinely different requests gets you a `422` (see below) instead of the second request executing; minting a fresh key on every retry defeats the point and lets a retried request double-spend/double-post.

```bash
curl -X POST https://api.marketer.sh/api/v1/jobs \
  -H "Authorization: Bearer $MARKETER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"niche_id": "...", "platform": "tiktok"}'
```

```ts
// TypeScript SDK
const job = await client.enqueueJob(
  { niche_id: nicheId, platform: "tiktok" },
  { idempotencyKey: crypto.randomUUID() } // generate once, reuse across your own retries
);
```

## How it works server-side (`backend/idempotency_api.py`)

An ASGI middleware, `IdempotencyMiddleware`, implements the full contract for every mutating route in one place — no per-route wiring needed once it's mounted:

- **Scope**: only `POST`/`PUT`/`PATCH`/`DELETE` with an `Idempotency-Key` header are touched at all. `GET`/`HEAD`/no-header requests fall straight through with zero overhead (no DB calls, no auth resolution).
- **Storage key**: `sha256(user_id + method + path + idempotency_key)` — scoped to the authenticated caller *and* to `(method, path)`, so the same key string can't collide across different endpoints or different users.
- **First request with a given key**: claims the key, runs the handler normally, and persists the full response (status, headers, body) against the key.
- **A later request with the same key, same body**: while the first is still in flight → `409` (`{"detail": "request with this Idempotency-Key is still being processed"}`); once the first has finished → the *original* stored response is replayed byte-for-byte, with an added `Idempotency-Replayed: true` response header so you can tell a replay from a live execution.
- **A later request with the same key but a *different* request body**: `422` (`{"detail": "Idempotency-Key was already used with a different request body. Use a new key for a new request."}`) — this is what happens if you accidentally reuse a key across two genuinely different logical operations.
- **Fail-open**: if the idempotency store itself is unreachable, the request runs un-deduplicated rather than the API going down — mirrors the same philosophy as the internal Modal-entrypoint guard below.

```bash
# First call executes; second call (same key) replays the first's response.
KEY=$(uuidgen)
curl -X POST .../api/v1/jobs -H "Idempotency-Key: $KEY" -d '{"niche_id":"...", "platform":"tiktok"}'
curl -X POST .../api/v1/jobs -H "Idempotency-Key: $KEY" -d '{"niche_id":"...", "platform":"tiktok"}'
# -> identical body to the first response, plus: Idempotency-Replayed: true
```

**Reconciliation note for the orchestrator — two things worth a decision before shipping:**

1. **Not yet mounted.** `IdempotencyMiddleware` is fully implemented but `backend/main.py::create_app()` does not currently register it (`app.add_middleware(IdempotencyMiddleware)` is absent). Until it's wired in, sending `Idempotency-Key` today is a harmless no-op — the header is ignored and every request executes live. This doc describes the middleware as designed/implemented since that's clearly the intended contract, but a client can't rely on dedup actually happening until this is confirmed mounted on the target deploy.
2. **Error shape mismatch.** The middleware's own 409/422 responses use `{"detail": "..."}` (plain FastAPI-style), not the structured `{"error": {code, message, hint, retryable, details}}` envelope documented in [`errors.md`](./errors.md) — because it runs as ASGI middleware, outside the exception-handler stack that normally produces that envelope (`backend/errors.py`'s handlers are registered on the `FastAPI` app, not the raw ASGI chain). A client parsing every error via `error.code` will not find one on these two responses. Worth aligning (e.g. render the same envelope from `_send_json`) so the error contract has no exceptions — flagging rather than editing `backend/idempotency_api.py` directly, which is outside this team's ownership this cycle.

## The internal (non-HTTP) idempotency guard

Separately, the pipeline itself is idempotent internally via `marketer.repos.idempotency` / `marketer.services.idempotency` (`claim_spawn(key)`): every Modal entrypoint that would otherwise double-execute on a retried invocation (`run_pipeline`, `run_niche_window`, `campaign_tick`) claims a stable key derived from the unit of work — e.g. `pipeline:{job_id}:{attempt_at}` — before doing anything with a side effect. This is a different layer (protects the async pipeline/worker from double-execution) from `IdempotencyMiddleware` above (protects the synchronous HTTP response from being duplicated) — the two compose: even if `POST /api/v1/jobs` somehow ran twice, `jobs_repo.create` inserting two rows is the actual duplicate-prevention gap the HTTP-layer middleware closes, while `claim_spawn` protects the *pipeline execution* once a job row exists and is spawned.

## What's safe to retry without a key at all

Every `GET` (read-only) is naturally idempotent — no key needed. Among mutations, a few are already safe without one because they're structured as atomic state transitions rather than "always insert a new thing":

- `POST /api/v1/jobs/{id}/approve`, `.../reject` — atomic `claim_for_scheduling` / `claim_for_rejection`: exactly one caller wins the transition; a duplicate call gets `409 conflict`, not a second side effect.
- `DELETE` endpoints (archive/revoke) — re-deleting an already-archived/revoked resource is a no-op or a clean `404`, not a second deletion.

Endpoints that insert a fresh row on every call (`POST /api/v1/jobs`, `POST /api/v1/articles`, ad campaign creation, ...) are exactly where a client-supplied `Idempotency-Key` matters most — a retried request without one risks a second job/article/campaign, not just a wasted call.
