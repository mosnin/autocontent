# marketer.sh API

Programmatic access to marketer.sh: niches (content channels), pipeline jobs, articles, ads, billing, calendar, and publishing automation. The same API the web dashboard uses — nothing is dashboard-only.

## Base URL

| Environment | Base URL |
|---|---|
| Production | `https://api.marketer.sh` |
| Local development | `http://localhost:8000` |

The authoritative list (including whatever `MARKETER_API_BASE_URL` is configured on a given deploy) is in the `servers` array of [`openapi.json`](./openapi.json).

## Versioning

- All routes are prefixed `/api/v1/...`. `v1` is additive-only for now: new optional fields and new endpoints may appear; existing fields are not removed or repurposed without a `v2` prefix.
- The machine-readable contract is [`openapi.json`](./openapi.json) in this directory, exported by `scripts/export_openapi.py` (see the root of this repo) and regenerated whenever a route changes. It is deterministic (sorted keys) so it diffs meaningfully in code review.
- `operationId`s are stable (`<tag>_<route-name>`) across deploys — safe to depend on in generated SDK method names.

## Where to go next

| Doc | What's in it |
|---|---|
| [`quickstart.md`](./quickstart.md) | curl, Python SDK, and TypeScript SDK: create a niche, enqueue a job, poll it to completion |
| [`authentication.md`](./authentication.md) | Personal access tokens (PATs), how to mint one, the Bearer scheme |
| [`errors.md`](./errors.md) | The structured error envelope and the stable `code` table |
| [`pagination.md`](./pagination.md) | The cursor (keyset) pagination scheme used by list endpoints |
| [`idempotency.md`](./idempotency.md) | The `Idempotency-Key` header for safely retrying mutating requests |
| [`openapi.json`](./openapi.json) | The full machine-readable spec — feed it to any OpenAPI tool (Redoc, Postman, openapi-typescript, ...) |

## Client libraries

- **Python** — `marketer.sdk.MarketerClient` (async, httpx-based), part of this repo's `src/marketer` package. See [`examples/python_quickstart.py`](../../examples/python_quickstart.py).
- **TypeScript** — [`@marketer/sdk`](../../packages/ts-sdk), generated types + a thin typed fetch wrapper. See [`packages/ts-sdk/README.md`](../../packages/ts-sdk/README.md).
- **MCP** — `marketer-mcp` exposes the same operations as tools for LLM agents (Claude Desktop, any MCP client). See [`examples/mcp_agent.md`](../../examples/mcp_agent.md).

## Interactive docs

FastAPI serves interactive Swagger UI at `/docs` and Redoc at `/redoc` on any running instance of the API (e.g. `http://localhost:8000/docs`), generated live from the same schema as `openapi.json`.
