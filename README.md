# marketer.sh

An agent-native marketing platform: one system that ideates, produces,
publishes, and learns from marketing content, and that runs paid campaigns
under a governed, fail-closed money path. It ships as a suite: three
products under one shell, each with its own dashboard, plus account-wide
settings shared across them.

Every product is driven the same way a human would drive it, or by an AI
agent through the REST API, a Python SDK, a CLI, or an MCP server. Agents
never move money without going through the same caps, approvals, and audit
trail a human would.

## The three products

### Studio: hook-driven short-form video

One channel in, daily videos out. The pipeline runs ten stages end to end:
ideation (angles picked from what the channel's last 30 days earned),
script (scene-by-scene narration and shot list), keyframes (DALL-E 3, kept
on-model by the channel's character sheet), animation (Grok Imagine turns
each keyframe into a clip), voiceover (OpenAI TTS), music (a bed ducked
under the voice), edit (ffmpeg assembles the cut), captions (Whisper
transcribes, word-level captions burn in), QA (duration, audio levels,
caption sync checked before anything can publish), and publish (scheduled
to TikTok, Reels, and Shorts in the channel's posting windows). Finished
jobs support per-scene reroll and full revoice without a full re-render.

### Press: SEO-optimized long-form articles

One channel brief, a full article. SERP research (Exa; degrades to model
knowledge when unconfigured, never fails the run), a structured outline (one
H1, five to ten H2s with writer notes), section-parallel writing under
E-E-A-T prose rules, QA scoring (keyword density, E-E-A-T, readability) with
one corrective rewrite below threshold, SEO metadata (title, slug,
description, keywords, JSON-LD for Article and FAQPage), internal-link
suggestions against the channel's archive, and an optional gpt-image-1 hero
image. Finished articles can publish to a connected WordPress site (the
user's own site credentials, stored per publish target, not a platform-wide
key), and Search Console data (rankings, query performance, coverage gaps)
feeds back into topic ideation once a user connects it.

### Ads: governed paid campaigns

Paid advertising (Google Ads, Meta Ads via Composio) is real money leaving
a connected payment method, so it runs on a strict fail-closed model, the
inverse of the fail-open content pipelines. The whole product is inert
unless `MARKETER_ADS_ENABLED` is true and the Composio keys are set: no
Composio call, no Inngest workflow, no spend-affecting action fires without
both. Every spend-affecting action funnels through one choke point
(`services/ad_actions_exec.py`) that evaluates the fail-closed
`AdSpendGuard` (per-account daily/monthly caps, kill switch, budget
ceiling), parks anything above the approval threshold as a pending approval
a human must clear, writes an append-only audit row for allow/deny/approval/
execute, and only then calls the platform. Approved actions are re-guarded
at execution and are single-use. Agents can propose optimizations; they
cannot move money alone. Ad experiments (A/B tests, budget ramps) route
through the same guard.

## Suite: the shared shell

Account-wide settings, connections, brand kit, billing, and admin, common
to all three products: niche/channel definitions and per-channel + global
spend caps, brand kit (tone, banned words, hashtags, accent color, blended
into both pipelines), content calendar, outbound webhooks, GDPR export and
erasure, and an admin console (SOC2-minded: role-gated, append-only audit
log of every privileged action, feature flags, a system-health panel, and
a go-live integrations checklist at `/admin/integrations`). See "Platform
surfaces" below for the full list.

Note on naming: the product concept is called a "channel" everywhere in the
UI and in this document. The database, API paths (`/api/v1/niches`), CLI
(`marketer niches`), and SDK (`niche=`) still use the original name
`niche`; that is a stable technical identifier, not a user-facing term.

## Configuration

`MARKETER_DATABASE_URL` is the only setting the platform cannot run
without. Everything else is additive: an unset key disables exactly the
feature it gates, cleanly, and never falls back to a fake success. Full
defaults live in `src/marketer/config.py`; this table covers what an
operator needs to decide before going live. The admin `/admin/integrations`
page shows live presence booleans for the provider keys below (never the
values).

| Env key | Unlocks | Behavior when absent |
| --- | --- | --- |
| `MARKETER_DATABASE_URL` | Everything (Supabase Postgres) | Nothing runs |
| `MARKETER_OPENAI_API_KEY` | Ideation, script, DALL-E keyframes, TTS, Whisper, article writing | Those calls fail; the job fails, no partial charge |
| `MARKETER_XAI_API_KEY` | Grok Imagine animation | Animation stage fails closed |
| `MARKETER_AYRSHARE_API_KEY` | Publishing to TikTok/Reels/Shorts | Publish stage fails closed |
| `MARKETER_PIXABAY_API_KEY` | Background music selection | Music stage skipped, video ships without a bed |
| `MARKETER_EXA_API_KEY` | Live SERP research for articles | Research degrades to model knowledge; the article still ships |
| `MARKETER_FAL_API_KEY` | Studio image/video tools (edit, upscale, remove background, animate) | Endpoints return 503 with a clear "configure the key" message |
| `MARKETER_CLERK_JWKS_URL` / `_CLERK_ISSUER` / `_CLERK_AUDIENCE` | Clerk session-JWT verification (browser login) | Clerk sessions are rejected; personal access tokens still work |
| `MARKETER_COMPOSIO_API_KEY` + `_COMPOSIO_GOOGLEADS_AUTH_CONFIG_ID` / `_METAADS_AUTH_CONFIG_ID` | Ads platform OAuth and execution | With `MARKETER_ADS_ENABLED`, Ads is fully inert; no Composio call is ever made |
| `MARKETER_INNGEST_SIGNING_KEY` + `_EVENT_KEY` | Durable Ads workflows (metrics sync, optimization, budget scaling) | Ads background workflows do not run |
| `MARKETER_ADS_ENABLED` | The whole Ads product | Ads is inert regardless of keys |
| `MARKETER_GOOGLE_OAUTH_CLIENT_ID` + `_CLIENT_SECRET` | Search Console connect flow, rankings/queries/gap data | Every GSC entry point raises a clean disabled error (409), never a fake result |
| `MARKETER_RESEND_API_KEY` | Transactional email and newsletter digests | Email send returns `False` silently; nothing else breaks (fail-open by design) |
| `MARKETER_STRIPE_SECRET_KEY` + `_WEBHOOK_SECRET` | Checkout, credit purchases, billing webhooks | With `MARKETER_BILLING_ENABLED`, billing is off; self-hosted deploys run unmetered |
| `MARKETER_BILLING_ENABLED` | Prepaid-credit billing | Off: no credit debit, no Stripe calls |
| `MARKETER_SENTRY_DSN` | Error reporting and tracing | No error reporting; the app runs the same either way |
| `MARKETER_OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry tracing export | All instrumentation is a no-op |
| `MARKETER_X402_ENABLED` + `_PAY_TO` + `_ASSET` | Agent-funded prepaid credit over HTTP 402 | The endpoint is inert |
| `MARKETER_PRESS_AUTOPILOT_ENABLED` | Scheduled article generation from approved topics | Topics wait for manual enqueue |
| `MARKETER_NEWSLETTERS_ENABLED` | Newsletter digest sending | No digests sent |
| `MARKETER_RATE_LIMIT_REDIS_URL` | Distributed rate limiting across instances | Falls back to in-process memory (fine for one instance) |

Per-account and per-channel spend caps, the audit log, and suspension
checks are always on; there is no env var that turns off the money or
safety path.

## Verified vs key-gated

The unit suite (stubbed connection pools, `httpx.MockTransport` for every
outbound HTTP call) covers the whole platform: both content pipelines, the
Ads governance and execution path, admin, billing, GDPR export/erasure,
GSC, competitor monitoring, content intelligence, and newsletters. No
external provider is called from CI or a clean dev box.

A smaller set of external integrations is additionally exercised as
integration tests against fakes, and genuinely needs production
credentials to do anything for real: fal.ai (Studio image/video), Composio
(Google Ads / Meta Ads execution), WordPress (per-user site credentials,
not a platform key), Google Search Console (OAuth), and Resend
(transactional email, fail-open by design). Everything else described in
this document, including the Ads spend guard, the article pipeline, and
the admin surface, is covered by the main test suite and does not require
any external account to verify.

## Stack

- **Orchestration**: OpenAI Agents SDK (multi-agent handoffs)
- **Runtime**: Modal (serverless GPU + scheduled jobs + volumes)
- **Image gen**: OpenAI DALL-E 3, gpt-image-1 (article heroes)
- **Animation**: Grok Imagine (xAI)
- **TTS**: OpenAI TTS
- **Transcription**: OpenAI Whisper
- **SERP research**: Exa
- **Ad platforms**: Composio (Google Ads, Meta Ads); Inngest (durable Ads workflows)
- **Video**: ffmpeg
- **Storage**: Modal volumes for clips/assets, Supabase Postgres metadata

## Multi-tenant

Every user is a Clerk identity. Per-user records (channels, jobs,
spend_ledger) live in Supabase Postgres. Video posting goes through one
Ayrshare account using per-user profile keys; article publishing goes
through per-user credentials stored per target (WordPress today). Artifacts
on the Modal volume are partitioned by `user_id`. Each channel has its own
daily spend cap that the pipeline checks before every credit-spending
stage.

## Layout

```
src/marketer/
  config.py            # env + settings (db url, clerk, secrets)
  db.py                # asyncpg pool
  pipeline.py           # run_job(user_id, niche_id, platform)
  orchestrator.py       # OpenAI Agents SDK wiring
  agents/                # one agent per LLM stage (video)
  articles/              # article pipeline (research, outline, write, QA, SEO)
  services/              # provider clients (DALL-E, Grok, ffmpeg, fal, gsc, composio_client, ...)
  models/                # pydantic schemas (User, Niche, Job, SpendEntry, ...)
  repos/                 # asyncpg repositories (users, niches, jobs, articles, spend, gsc, competitors, ...)
  storage/                # Modal volume layout helpers
  cli.py                  # `marketer` CLI entry point
  mcp_server.py           # `marketer-mcp` MCP server entry point
backend/               # FastAPI on Modal, the REST surface for the web UI
  main.py
  auth.py              # Clerk JWT + PAT verification
  routes/              # users, niches, jobs, press, ads, admin, gsc, competitors, newsletters, ...
web/                   # Next.js (App Router) + Clerk
  app/(marketing)/     # public site (marketing copy owned here)
  app/(app)/           # the product: dashboard, studio, press, ads, library, admin, settings
  lib/api.ts            # JWT-attaching fetch client
db/migrations/         # plain SQL, applied in filename order
modal_app.py            # Modal entry: run_pipeline, nightly_batch, api (ASGI)
e2e/                     # Playwright smoke suite against a built web app
```

Note: directory and identifier names above (`niches`, `Niche`, `niche_id`)
are the literal technical names in code, the database, and the API. The
product-facing name for the same concept is "channel" (see "Suite" above).

## Running

```bash
# 0. Configure env (see .env.example). MARKETER_DATABASE_URL at minimum.

# 1. Apply all migrations via the yoyo runner (never psql a single file;
#    that bypasses yoyo's bookkeeping and breaks later `marketer-migrate up`).
modal run modal_app.py::apply_migrations        # or locally: marketer-migrate up

# 2. Deploy the Modal app (pipeline + FastAPI)
modal deploy modal_app.py

# 3. Pre-warm onboarding voice previews (one-time)
modal run modal_app.py::prewarm_voice_previews

# 4. Start the web UI
cd web && npm install && npm run dev
```

See `db/README.md` for the full migration workflow (status, rollback, CI gate).

## Platform surfaces

Beyond the three products, the platform ships:

- **Content calendar**: `GET /api/v1/calendar` and a `/calendar` agenda
  view unify scheduled video posts and article activity in one feed.
- **Brand kit**: a reusable brand identity (name, tone, banned words,
  hashtags, accent color) that seeds one-sentence channel drafts and steers
  the article writer, so new channels and long-form content come out
  on-brand. `GET/PUT /api/v1/brand-kit`, `/settings/brand`.
- **Content repurposing**: `POST /api/v1/articles/{id}/social` turns a
  finished article into platform-native posts (X, LinkedIn, Instagram,
  Facebook, newsletter) in one metered call.
- **Content intelligence**: topic-cluster planning, a corpus audit, and
  cannibalization detection over a channel's article archive
  (`backend/routes/intelligence.py`).
- **Competitor monitoring**: an hourly scan diffs tracked competitor
  content and surfaces performance alerts in an inbox
  (`backend/routes/competitors.py`).
- **Newsletters**: digest compose/send plus an hourly autopilot cadence,
  gated by `MARKETER_NEWSLETTERS_ENABLED` (`backend/routes/newsletters.py`).
- **Google Search Console**: OAuth connect, ranking/query performance, and
  content-gap detection that feeds article ideation
  (`backend/routes/gsc.py`).
- **Outbound webhooks**: register HTTPS endpoints that receive
  HMAC-SHA256-signed event deliveries (`job.done/failed/awaiting_approval`,
  `article.done/failed`). Fully fail-open; managed at `/settings/webhooks`.
- **Admin console (SOC2-minded)**: `/admin/*` behind a DB-checked `admin`
  role: platform overview, user management (suspend, role, credit grants),
  an append-only audit log of every privileged action (actor, target, IP,
  UA), feature flags, a system-health panel, and an integrations checklist
  (`/admin/integrations`) showing which provider keys are configured.
  Suspended accounts are refused in the auth path itself.
- **Data & privacy (GDPR)**: one-click data export
  (`GET /users/me/export`) and account erasure (`DELETE /users/me`, FK
  cascade) at `/settings/privacy`.
- **Spend controls everywhere**: per-channel daily cap, optional per-user
  global cap, prepaid credits; every LLM/image/video/TTS call metered to a
  ledger and gated race-safely.
- **x402 agent payments**: agents fund their own prepaid credit over HTTP
  402 (Coinbase's protocol). `POST /api/v1/x402/credits` answers `402` with
  a payment envelope, then verifies and settles the `X-PAYMENT` via a
  facilitator and credits the caller's balance idempotently. Off by
  default; see the x402 config in `config.py`.
- **Legal**: a full `/legal` surface (Terms, Privacy, Acceptable Use,
  Cookies, Subprocessors, DPA, Refund).

## Testing

`pytest` runs roughly 940 tests: unit tests against stubbed connection
pools and `httpx.MockTransport` fakes, plus a set of real-Postgres tests
(`tests/integration/` and the `test_*_repo_pg.py` files under `tests/`)
that exercise the money and admin paths, GSC, competitors, and newsletters
against an actual database, credit-purchase idempotency, atomic debit and
ledger, spend-cap summation, append-only audit, and GDPR erasure cascade
included. Postgres-backed tests skip when `MARKETER_DATABASE_URL` is unset
and run automatically in CI (which provisions Postgres). A Playwright smoke
suite in `e2e/` separately verifies the built web app serves its marketing
and product routes; see `e2e/README.md`. `sitemap.xml` and `robots.txt`
ship for the marketing site.

## Roadmap

Additional publishing integrations beyond WordPress (Ghost, Medium,
Shopify, Dev.to), per-client brand kits and team seats for agencies, and
semantic dedup memory across a channel's archive.
