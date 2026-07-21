# Pointing an MCP client at `marketer-mcp`

`marketer-mcp` (`src/marketer/mcp_server.py`) exposes the same operations as the Python/TypeScript SDKs — niches, jobs, articles, ads, spend, connect, tokens — as MCP tools, so any MCP-capable agent (Claude Desktop, the Claude CLI, a custom `openai-agents`/LangChain MCP client, ...) can drive marketer.sh without you writing glue code.

It talks to the same public HTTP API documented in [`docs/api/`](../docs/api/) — a personal access token is all it needs; there's no separate agent-only auth path.

## 1. Get a personal access token

See [`docs/api/authentication.md`](../docs/api/authentication.md). You need `mkt_...`, not a Clerk session JWT.

## 2. Install

`marketer-mcp` is a console script from this repo's `pyproject.toml` (`[project.scripts] marketer-mcp = "marketer.mcp_server:main"`):

```bash
# from the repo root, inside the project's venv / via uv
uv sync
uv run marketer-mcp   # will exit 2 immediately without env vars — see step 3
```

Or, once published, `pip install marketer-sh` gives you the `marketer-mcp` command directly.

## 3. Configure environment

`marketer-mcp` reads exactly two environment variables at startup (`marketer.mcp_server.main`):

| Variable | Meaning |
|---|---|
| `MARKETER_API_BASE_URL` | e.g. `https://api.marketer.sh` or `http://localhost:8000` |
| `MARKETER_API_TOKEN` | your PAT, `mkt_...` |

Missing either exits immediately with status 2 and a message on stderr — nothing silently no-ops.

## 4. Point an MCP client at it

### Claude Desktop / Claude Code (stdio transport)

Add to the client's MCP server config (Claude Desktop: `claude_desktop_config.json`; Claude Code: project or user `.mcp.json`):

```json
{
  "mcpServers": {
    "marketer": {
      "command": "uv",
      "args": ["run", "marketer-mcp"],
      "cwd": "/path/to/autocontent",
      "env": {
        "MARKETER_API_BASE_URL": "https://api.marketer.sh",
        "MARKETER_API_TOKEN": "mkt_your_token_here"
      }
    }
  }
}
```

(Swap `"command": "uv", "args": ["run", "marketer-mcp"]` for `"command": "marketer-mcp"` directly if it's installed on `PATH` outside a uv-managed venv.)

Restart the client; it will spawn `marketer-mcp` over stdio and discover the tools below automatically.

### Any other MCP client

`marketer-mcp` uses `FastMCP` (`mcp.server.fastmcp`) and runs the default **stdio** transport via `server.run()` — any MCP client that can spawn a subprocess and speak MCP-over-stdio works the same way as above. There is no HTTP/SSE transport configured today; if your client only speaks HTTP MCP, front the stdio process with a generic MCP stdio-to-HTTP bridge, or ask the platform team about adding one (out of this team's ownership — flagging for reconciliation if agent integrations need it).

## 5. What the agent can do

Representative tools (see `src/marketer/mcp_server.py::build_server` for the full, current list — it stays in lockstep with the SDK):

| Tool | Cost / side effects |
|---|---|
| `list_niches`, `get_niche` | Read-only, cheap |
| `create_niche` | No immediate cost — spend only happens on `enqueue_job` |
| `archive_niche` | Soft-delete; tool description tells the agent to confirm with the user first |
| `list_jobs`, `get_job` | Read-only, cheap |
| `enqueue_job` | **Expensive** — spawns a real pipeline run (~$1.80 for a 6-scene 480p job per the tool's own description) and consumes the niche's daily spend cap. The tool description explicitly tells the calling model to confirm with the user before invoking it. |
| `retry_job` | Same cost profile as `enqueue_job` |
| `list_articles`, `get_article`, `get_article_markdown` | Read-only, cheap |

Each tool's `description=` string (visible to the calling LLM) already states cost and whether user confirmation is expected — written specifically for an LLM caller, not just human API docs, so a well-behaved agent will naturally ask before spending money.

## 6. Errors

Non-2xx responses from the underlying API surface to the agent as a `MarketerError` from the Python SDK — currently a stringified `{status_code}: {body}` (see the reconciliation note in [`docs/api/errors.md`](../docs/api/errors.md) about `MarketerError` not yet exposing the parsed `code`/`retryable` fields). An agent should treat any tool call failure conservatively (don't blindly retry a write) until that's addressed.

## 7. Sanity-checking locally without a live agent

```bash
uv run python - <<'PY'
import asyncio
from marketer.mcp_server import build_server

async def main():
    server = build_server(base_url="http://localhost:8000", token="mkt_your_token_here")
    tools = await server.list_tools()
    print([t.name for t in tools])

asyncio.run(main())
PY
```

This lists every registered tool name without needing a real MCP client — useful for confirming the server boots and the tool set matches what you expect before wiring up Claude Desktop / another client.
