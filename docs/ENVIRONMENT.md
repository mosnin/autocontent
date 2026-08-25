# Environment variables

Environment lives in **five** places, and they do not overlap. A key set
in one is not visible to the others — which is the single most common way
this stack half-works.

| # | Surface | Where it is set | Count |
|---|---|---|---|
| 1 | FastAPI backend | `.env` / Modal secrets | 98 settings, `MARKETER_` prefix |
| 2 | Next.js web app | `web/.env.local` / Vercel | 4 |
| 3 | SDK / CLI / MCP client | the caller's shell | 2 |
| 4 | Modal deployment | `modal secret create` | 5 named secrets |
| 5 | Tests / CI | GitHub Actions | 4 |

---

## 1. Minimum to boot

Every setting in `config.py` has a default and nothing raises at import,
so the app **starts with nothing set** and features fail closed instead.
That makes "what do I actually need" non-obvious. Only these have no
graceful degradation:

```bash
MARKETER_DATABASE_URL=postgresql://...  # pooled; db.py get_pool() raises without it
MARKETER_DATABASE_DIRECT_URL=...        # unpooled; migrations only, falls back to the above
MARKETER_OPENAI_API_KEY=sk-...         # the only preflight ERROR
MARKETER_CLERK_JWKS_URL=https://<app>.clerk.accounts.dev/.well-known/jwks.json
MARKETER_CLERK_ISSUER=https://<app>.clerk.accounts.dev
```

Plus, for the web app:

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...   # read at BUILD time
CLERK_SECRET_KEY=sk_...                    # read by middleware.ts
NEXT_PUBLIC_API_BASE_URL=https://<api>     # the proxy's forward target
```

**To render a video end to end** you also need an animation provider and a
voice: `MARKETER_XAI_API_KEY` (the default backend) or
`MARKETER_FAL_API_KEY`, plus `MARKETER_ELEVENLABS_API_KEY`.

### Don't take this list on faith

The codebase reports its own answer for your environment:

```bash
python -c "import sys;sys.path.insert(0,'src');\
from marketer.services.preflight import run_preflight;\
r=run_preflight();print(r.overall_status);\
[print(c.to_dict()['status'], c.to_dict()['capability'], c.to_dict()['message'][:90]) for c in r.checks]"
```

Against a completely empty environment it returns **16 checks, 1 error,
5 warnings** — error: OpenAI; warnings: Grok, fal, OpenRouter, ElevenLabs
voice, generated music. Everything else reports `ok` because it is
feature-flagged off.

`MARKETER_PREFLIGHT_STRICT=true` turns those warnings into a hard startup
failure.

---

## 2. Backend — all 98 settings

`src/marketer/config.py` sets `env_prefix="MARKETER_"`.

> **`OPENAI_API_KEY` is not read. `MARKETER_OPENAI_API_KEY` is.**
> The prefix applies to every setting without exception. An unprefixed
> name is silently ignored, which looks identical to a missing key.

The full annotated list is `.env.example` at the repo root — all 98,
grouped, with defaults and what breaks without each. Copy it to `.env`.

---

## 3. Web app — 4

Set in `web/.env.local` locally, or the Vercel project env.

| Variable | Read by | Notes |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `@clerk/nextjs` | Needed at **build** time, not just runtime |
| `CLERK_SECRET_KEY` | `middleware.ts` | Without it every protected route 500s |
| `NEXT_PUBLIC_API_BASE_URL` | `lib/api.ts`, `app/api/proxy/[...path]/route.ts` | Also re-exported in `next.config.js` |
| `NEXT_PUBLIC_SITE_URL` | `app/robots.ts`, `app/sitemap.ts` | Canonical origin for SEO output |

`web/.env.local.example` covers the first three.

---

## 4. SDK / CLI / MCP client — 2

These are for *calling* the API, not running it. Read from the caller's
shell by `sdk.py`, `cli.py` and `mcp_server.py`; both must be set or the
CLI exits with an error naming them.

```bash
MARKETER_API_BASE_URL=https://<your-api>
MARKETER_API_TOKEN=mkt_...        # created in Settings -> API tokens
```

Tokens are stored hash-only (`repos/tokens.py`), so the plaintext is
shown once at creation and cannot be recovered.

---

## 5. Modal deployment — and a real gap

Modal auth is not an env var:

```bash
modal token set --token-id <id> --token-secret <secret>
```

`modal_app.py` mounts exactly **five** named secrets, app-wide:

| Secret | Supplies |
|---|---|
| `marketer-openai` | `MARKETER_OPENAI_API_KEY` |
| `marketer-xai` | `MARKETER_XAI_API_KEY` |
| `marketer-ayrshare` | `MARKETER_AYRSHARE_API_KEY` |
| `marketer-database` | `MARKETER_DATABASE_URL`, `MARKETER_DATABASE_DIRECT_URL` |
| `marketer-clerk` | `MARKETER_CLERK_JWKS_URL`, `MARKETER_CLERK_ISSUER` |

```bash
modal secret create marketer-openai MARKETER_OPENAI_API_KEY=sk-...
# ...one per row above
```

**The gap:** every other key has no secret wired. fal, ElevenLabs,
OpenRouter, Stripe, MuAPI/UGC, Seedance, Context.dev, Resend, Pexels,
Exa, Wasabi, Composio and Inngest are all read by the backend but are
**not mounted into the Modal deployment**. Setting them in a local `.env`
makes them work locally and silently not in production — the feature just
fails closed on the deployed app.

Fix by creating a secret and adding it to the `secrets` list in
`modal_app.py`, e.g.:

```bash
modal secret create marketer-providers \
  MARKETER_FAL_API_KEY=... MARKETER_ELEVENLABS_API_KEY=...
```

```python
# modal_app.py
modal.Secret.from_name("marketer-providers"),
```

---

## 6. Tests and CI

| Variable | Used by |
|---|---|
| `MARKETER_DATABASE_URL` | `tests/integration/*` — they skip when unset |
| `MARKETER_RUN_LIVE_EVALS` | `tests/evals/test_live_agent_evals.py`; off by default because it spends real money |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | the Postgres service container in GitHub Actions |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | the web build step in CI — a placeholder is enough |

Migrations read `MARKETER_DATABASE_URL` directly rather than through
settings, so `scripts/migrate.py` works before the app is configured:

```bash
python scripts/migrate.py   # applies db/migrations via yoyo
```

---

## Verified vs not

Everything here is read from source: `config.py`, `db.py`,
`services/preflight.py`, `modal_app.py`, `sdk.py`, `cli.py`,
`mcp_server.py`, `scripts/migrate.py`, the `web/` tree and
`.github/workflows/`. The preflight numbers come from actually running it
against an empty environment.

**Not verified:** no one has booted this stack against a real database or
Clerk instance from these notes. If something is wrong, that is where it
will be.
