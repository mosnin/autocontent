# Pagination

The API uses opaque-cursor (keyset) pagination for list endpoints, implemented in `backend/pagination.py`. Keyset pagination scales better than offset/limit (no re-scanning skipped rows) and stays correct under concurrent inserts/deletes — an offset-based page can silently skip or repeat rows when the underlying table changes between requests; a cursor can't.

## Request

```
GET /api/v1/<resource>?limit=20&cursor=<opaque-string>
```

| Param | Default | Bounds | Meaning |
|---|---|---|---|
| `limit` | 20 | 1–100 | Max items to return in this page |
| `cursor` | (none) | — | Opaque string from a previous page's `next_cursor`. Omit for the first page. |

The cursor is base64, tamper-evident (HMAC-signed), and versioned — treat it as an opaque token, never construct or parse one yourself. A malformed or forged cursor is rejected with `400 bad_request` (see [`errors.md`](./errors.md)), not silently ignored.

## Response envelope

```json
{
  "items": [ /* ... up to `limit` resources ... */ ],
  "next_cursor": "eyJib2R5Ijoi...opaque...",
  "has_more": true
}
```

| Field | Meaning |
|---|---|
| `items` | The page of resources, in the endpoint's documented sort order |
| `next_cursor` | Pass this as `cursor` on the next request to get the following page. `null` when there is no next page. |
| `has_more` | `true` iff another page exists. Prefer checking this over `next_cursor !== null` — they're kept in sync but `has_more` is the intended check. |

## Client usage

```bash
# first page
curl "https://api.marketer.sh/api/v1/jobs?limit=20" -H "Authorization: Bearer $MARKETER_API_TOKEN"

# next page, using the previous response's next_cursor
curl "https://api.marketer.sh/api/v1/jobs?limit=20&cursor=eyJib2R5Ijoi..." \
  -H "Authorization: Bearer $MARKETER_API_TOKEN"
```

```python
# Python SDK — pass limit; loop using next_cursor once a route exposes one (see note below)
jobs = await client.list_jobs(limit=20)
```

```ts
// TypeScript SDK
const jobs = await client.listJobs({ limit: 20 });
```

## Current status — flagging for reconciliation

`backend/pagination.py` (the `PageParams` / `Page[T]` / cursor helpers described above) is a ready-to-use module, but **no route has adopted it yet** as of this writing. Today's list endpoints (`GET /api/v1/niches`, `GET /api/v1/jobs`, `GET /api/v1/articles`, ...) accept a plain `limit` query param and return a bare JSON array — no `cursor`/`next_cursor`/`has_more` envelope, and no keyset pagination past whatever `limit` (max Depends on route) returns.

This doc describes the **intended, standard scheme** so routes converge on it as they're updated; until a given route returns the `{items, next_cursor, has_more}` shape, treat it as first-page-only (raise `limit` up to that route's max — commonly 100–200 today — rather than expecting a `cursor` param to work). Check that specific route's entry in [`openapi.json`](./openapi.json) (or `/docs`) to see whether it has been migrated: a migrated route's response schema will be named `Page_<Model>_` or similar and include `next_cursor`/`has_more` properties.
