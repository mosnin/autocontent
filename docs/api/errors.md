# Errors

Every error response — whatever raised it internally — renders as the same JSON envelope (`backend/errors.py`):

```json
{
  "error": {
    "code": "not_found",
    "message": "campaign not found",
    "hint": null,
    "retryable": false,
    "details": null
  }
}
```

| Field | Type | Meaning |
|---|---|---|
| `code` | string | Stable, machine-parseable identifier. Safe to `switch`/branch on in client code — see the table below. |
| `message` | string | Human-readable description. May change wording across releases; don't parse it. |
| `hint` | string \| null | Optional suggestion for how to fix the request (not always present). |
| `retryable` | boolean | `true` if a client may reasonably retry the *same* request (possibly after a backoff / `Retry-After`). `false` means retrying without changing anything will fail the same way again. |
| `details` | object \| null | Optional structured extra context — e.g. per-field validation errors (see below). |

Every response, error or not, also carries an **`X-Request-ID`** header — the correlation id from the inbound `X-Request-ID` request header if you sent one, otherwise a freshly minted UUID4. Include it in bug reports / support requests; server logs are keyed on it. `500` responses in particular never leak internals (tracebacks, SQL, file paths) in the body — only the request id, which support can use to look up the real exception server-side.

## Code table

| HTTP status | `code` | `retryable` | When |
|---|---|---|---|
| 400 | `bad_request` | false | Malformed request (e.g. an invalid pagination cursor) |
| 401 | `unauthorized` | false | Missing/invalid/expired bearer token |
| 402 | `spend_cap_exceeded` | false | A spend/budget guard blocked the action (daily niche cap, global kill-switch, x402 payment required) |
| 403 | `forbidden` | false | Authenticated, but not permitted (suspended account, non-admin hitting an admin route, resource owned by someone else) |
| 404 | `not_found` | false | Resource doesn't exist, or exists but isn't owned by the caller (routes intentionally don't distinguish these) |
| 405 | `method_not_allowed` | false | Wrong HTTP verb for the path |
| 409 | `conflict` | false | State machine conflict — e.g. approving a job that isn't `awaiting_approval` |
| 422 | `validation_failed` | false | Request body/query failed Pydantic validation. `details.errors` is a list of `{loc, msg, type}` — one per invalid field (FastAPI's native shape, passed through) |
| 429 | `rate_limited` | true | Per-route or auth-failure rate limit exceeded |
| 502 | `provider_error` | true | An upstream provider (LLM, ad platform, publishing API, ...) failed |
| 503 | `unavailable` | true | The service or a required dependency is temporarily down |
| 504 | `timeout` | true | Upstream timeout |
| 500 | `internal_error` | true (for the generic unhandled-exception case) | Unhandled server error. Body is generic (`"an unexpected error occurred"`); `details.request_id` echoes the correlation id |

New route code raises typed exceptions from `backend.errors` (`NotFoundError`, `ConflictError`, `SpendCapExceededError`, `ProviderError`, ...) or their `raise_*()` factory helpers, which carry `code`/`retryable` explicitly. Older routes that still raise a plain `fastapi.HTTPException(status_code, detail)` are mapped into the identical envelope shape by inferring `code`/`retryable` from the HTTP status code (see the table above) — client code never needs to know which path a given route takes.

## Client-side handling

**Python SDK** (`marketer.sdk.MarketerClient`) raises `MarketerError` on any non-2xx response:

```python
from marketer.sdk import MarketerClient, MarketerError

async with MarketerClient() as client:
    try:
        await client.get_niche("00000000-0000-0000-0000-000000000000")
    except MarketerError as e:
        print(e.status_code, e.message)  # message is currently the raw response body/JSON
```

> Note for the orchestrator: `MarketerError` today only carries `status_code` + a stringified response body, not the parsed `code`/`retryable`/`hint` fields. Worth a follow-up to parse the envelope (mirroring what the TS SDK's `MarketerApiError` does below) so Python callers can branch on `.code` too — flagging for reconciliation rather than changing `sdk.py`, which is out of this team's ownership.

**TypeScript SDK** (`@marketer/sdk`) throws `MarketerApiError` with the envelope already parsed:

```ts
import { MarketerClient, MarketerApiError } from "@marketer/sdk";

try {
  await client.getNiche("00000000-0000-0000-0000-000000000000");
} catch (err) {
  if (err instanceof MarketerApiError) {
    console.error(err.code, err.message, "retryable:", err.retryable, "request:", err.requestId);
  } else {
    throw err;
  }
}
```

## A note on `spend_cap_exceeded` (402)

This code is intentionally distinct from generic `forbidden` (403): it means the request was well-formed and would otherwise have succeeded, but a budget guard (per-niche daily cap, global kill-switch) blocked it. It is also reused for x402 micropayment flows (`POST /api/v1/x402/credits`) where a 402 is the *expected first response* carrying payment requirements rather than a true failure — see that route's docs for the two-call handshake.
