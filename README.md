# marketer.sh

Autonomous marketing platform for AI agents: one system that ideates,
produces, publishes, and learns from marketing content across formats.

It's a **suite** — a Google-Workspace-style set of distinct products under one
shell, each with its own dashboard and focused navigation (an app switcher
jumps between them; the sidebar shows only the active product):

- **Studio** — hook-driven short-form video for TikTok / Reels / Shorts.
- **Press** — SEO-optimized long-form articles: SERP research, structured
  outline, section-parallel writing, QA scoring, metadata + JSON-LD, hero image.
- **Ads** — create, manage, and scale **paid** campaigns (Google Ads, Meta Ads)
  with agents, governed by fail-closed budget guardrails, human approvals, and
  an audit trail. See "Ads product" below.
- **Suite** — account-wide settings, connections, brand kit, billing, admin.

All products share the same niches, spend caps, billing, brand kit, and agent
surfaces (REST API, Python SDK, CLI, MCP server).

## Video pipeline

1. **Ideation** — pick a topic + write the hook
2. **Script** — break the topic into scenes (each scene = 1 image + 1 animation + caption beat)
3. **Visuals** — DALL-E 3 generates a keyframe per scene
4. **Animation** — Grok Imagine animates each keyframe into a short clip
5. **Voiceover** — TTS narrates the script
6. **Music** — background track is picked + ducked under VO
7. **Edit** — clips, VO, music are stitched with ffmpeg
8. **Captions** — Whisper transcribes the VO; captions are burned in
9. **QA** — two gates: a deterministic ffprobe pass on the rendered file
   (real duration covers the narration, streams present, audio not silent,
   fits the upload size limit — auto re-encoded when it doesn't) and an
   LLM content pass (hook strength, niche drift)
10. **Publish** — schedule to TikTok / Reels / Shorts

Scene keyframes are steered by a per-niche character/style reference
sheet; set a niche's `character_description` to cast your own recurring
characters (the sheet regenerates whenever the style or cast is edited).
Curated **style presets** (`/api/v1/style-presets`) offer one-click art
direction, each with an optional reference video of the style.
Failed jobs **resume** on retry — a transient provider error keeps the
already-paid script/clips/voiceover; only QA content rejections start over.

### Media library + Wasabi object storage

Every produced artifact — scene clips, keyframes, voiceovers, final
videos — is archived after render QA into the **media library**
(`media_assets`, migration 0018) and mirrored to **Wasabi S3** when
configured (`MARKETER_WASABI_*`; off by default, the library indexes the
Modal volume instead). The `/library` page lists finals and clips with
playback (presigned Wasabi URLs or volume streaming), filterable by
niche. Selecting clips creates a **remix** (`compositions`): a new video
concatenated server-side from existing clips — systemized editing
without re-paying for generation.

## Article pipeline

1. **Topic** — picked for the niche (deduped against recent articles) or supplied by the caller
2. **Research** — Exa SERP analysis of what currently ranks (degrades to model knowledge when unconfigured)
3. **Outline** — one H1, 5-10 H2s with writer notes
4. **Write** — sections drafted in parallel, E-E-A-T prose rules enforced
5. **QA** — keyword density + E-E-A-T + readability scoring; one corrective rewrite below threshold
6. **SEO metadata** — title, slug, meta description, keywords, JSON-LD (Article + FAQPage)
7. **Internal links** — suggestions against the user's prior articles
8. **Hero image** — gpt-image-1 editorial hero (optional)

Every LLM/image call in both pipelines is metered into the same
`spend_ledger` and gated by per-niche + global daily caps and prepaid
credits.

## Ads product (paid campaigns)

The Ads product lets agents run **paid** advertising — real money leaving the
user's payment method on the ad platform — so it is engineered around a strict,
**fail-CLOSED** safety model (the inverse of the fail-open content pipelines).

- **Integrations**: [Composio](https://composio.dev) for per-user OAuth to ad
  platforms (Google Ads, Meta Ads) and agent tool access (OpenAI Agents SDK
  provider); [Inngest](https://www.inngest.com) for durable, checkpointed
  background workflows (metrics sync cron, optimization, budget scaling) served
  at `/api/inngest` on the same FastAPI app.
- **Off by default**: the whole product is inert unless `MARKETER_ADS_ENABLED`
  is true *and* the relevant keys are set (`MARKETER_COMPOSIO_API_KEY`, auth
  config ids, Inngest keys). Missing packages surface as a clean `AdsDisabled`
  (409), never an ImportError or a 500. Every external call is mocked in tests —
  no real campaign can be created from CI or a dev box.
- **The money contract**: every spend-affecting action funnels through one
  choke point (`services/ad_actions_exec.py`) that (1) evaluates the
  fail-closed `AdSpendGuard` (per-account daily/monthly caps, kill-switch,
  account-wide budget ceiling, negative-budget/inactive-account guards), (2)
  parks any change above the approval threshold as a **pending approval** that a
  human must approve before it applies, (3) writes an **append-only** audit row
  for allow/deny/approval/execute, and only then (4) makes the platform call.
  Approved actions are re-guarded at execution time and are single-use (no
  replay). Agents can *propose* optimizations but can never move money alone.
- **Surfaces**: `/api/v1/ads/*` (accounts, governance, campaigns, approvals,
  actions, overview); `/ads` dashboard, `/ads/connect`, `/ads/approvals` inbox,
  `/ads/activity` audit log. Schema in migration `0015_ads.sql`
  (`ad_accounts`, `ad_campaigns`, `ad_sets`, `ad_creatives`, `ad_metrics_daily`,
  `ad_actions_log`, `ad_approvals`).

## Stack

- **Orchestration**: OpenAI Agents SDK (multi-agent handoffs)
- **Runtime**: Modal (serverless GPU + scheduled jobs + volumes)
- **Image gen**: OpenAI DALL-E 3
- **Animation**: Grok Imagine (xAI)
- **TTS**: OpenAI TTS
- **Transcription**: OpenAI Whisper
- **SERP research**: Exa
- **Video**: ffmpeg
- **Storage**: Modal volumes for clips/assets, Supabase Postgres metadata

## Multi-tenant

Every user is a Clerk identity. Per-user records (`niches`, `jobs`,
`spend_ledger`) live in Supabase Postgres. Posting goes through one
Ayrshare account using per-user profile keys. Artifacts on the Modal
volume are partitioned by `user_id`. Each niche has its own daily spend
cap that the pipeline checks before every credit-spending stage.

## Layout

```
src/marketer/
  config.py            # env + settings (db url, clerk, secrets)
  db.py                # asyncpg pool
  pipeline.py          # run_job(user_id, niche_id, platform)
  orchestrator.py      # OpenAI Agents SDK wiring
  agents/              # one agent per LLM stage (video)
  articles/            # article pipeline (research, outline, write, QA, SEO)
  services/            # provider clients (DALL-E, Grok, ffmpeg, ...)
  models/              # pydantic schemas (User, Niche, Job, SpendEntry, ...)
  repos/               # asyncpg repositories (users, niches, jobs, articles, spend)
  storage/             # Modal volume layout helpers
backend/               # FastAPI on Modal — REST surface for the web UI
  main.py
  auth.py              # Clerk JWT verification
  routes/              # users, niches, jobs
web/                   # Next.js (App Router) + Clerk
  app/                 # /, /onboarding, /dashboard, /queue
  lib/api.ts           # JWT-attaching fetch client
db/migrations/         # plain SQL, applied in filename order
modal_app.py           # Modal entry: run_pipeline, nightly_batch, api (ASGI)
```

## Running

```bash
# 0. Configure env (see .env.example) — MARKETER_DATABASE_URL at minimum.

# 1. Apply all migrations via the yoyo runner (never psql a single file —
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

### Optional provider keys

Everything below ships dark: without the key the feature is disabled (or
falls back) and the rest of the platform is unaffected. Set them as
`MARKETER_*` env vars / Modal secrets:

| Key | Unlocks |
| --- | --- |
| `MARKETER_FAL_API_KEY` | Fal video models (Kling, Veo 3, Sora 2, Hailuo, Luma, Pixverse, Wan) + OmniHuman lip-synced UGC avatars |
| `MARKETER_OPENROUTER_API_KEY` | Per-niche scriptwriter model choice (Claude, GPT, Gemini, DeepSeek, Llama) |
| `MARKETER_ELEVENLABS_API_KEY` | ElevenLabs voices (`voice_provider='elevenlabs'`) **and** generated background music (`music_provider='auto'/'generated'`) |
| `MARKETER_PIXABAY_API_KEY` | Stock music fallback chain |
| `MARKETER_WASABI_*` (`wasabi_enabled=true`, endpoint, region, bucket, keys) | Durable object storage for every produced artifact + template reference mirroring |
| `MARKETER_FAL_PRICE_OVERRIDES` | JSON `{model_id: usd_per_second}` correcting pinned fal prices without a deploy |

Deploy checklist when bumping to this version: `marketer-migrate up`
(migrations through 0023), `modal deploy modal_app.py`, then set any new
keys above.

## Platform surfaces

Beyond the two content pipelines, the product ships:

- **Content calendar** — `GET /api/v1/calendar` and a `/calendar` agenda
  view unify scheduled video posts and article activity in one feed.
- **Brand kit** — a reusable brand identity (name, tone, banned words,
  hashtags, accent color) that both seeds one-sentence channel drafts and
  steers the article writer (blended into the tone the outliner, section
  writers, and QA all see) so new channels *and* long-form content come out
  on-brand. `GET/PUT /api/v1/brand-kit`, `/settings/brand`.
- **Content repurposing** — `POST /api/v1/articles/{id}/social` turns a
  finished article into platform-native posts (X, LinkedIn, Instagram,
  Facebook, newsletter) in one metered call; surfaced on the article page
  and via the SDK/MCP `repurpose_article`.
- **Outbound webhooks** — register HTTPS endpoints that receive
  HMAC-SHA256-signed event deliveries (`job.done/failed/awaiting_approval`,
  `article.done/failed`). Fully fail-open; managed at `/settings/webhooks`.
- **Admin console (SOC2-minded)** — `/admin/*` behind a DB-checked `admin`
  role: platform overview, user management (suspend, role, credit grants),
  an **append-only audit log** of every privileged action (actor, target,
  IP, UA), feature flags, and a system-health panel. Suspended accounts are
  refused in the auth path itself.
- **Data & privacy (GDPR)** — one-click data export
  (`GET /users/me/export`) and account erasure (`DELETE /users/me`, FK
  cascade) at `/settings/privacy`.
- **Spend controls everywhere** — per-niche daily cap, optional per-user
  global cap, prepaid credits; every LLM/image/video/TTS call metered to a
  ledger and gated race-safely.
- **x402 agent payments** — agents fund their own prepaid credit over HTTP
  402 (Coinbase's protocol). `POST /api/v1/x402/credits` answers `402` with a
  payment envelope, then verifies + settles the `X-PAYMENT` via a facilitator
  and credits the caller's balance idempotently (keyed on the on-chain
  settlement id). Off by default; see the x402 config in `config.py`.
- **Legal** — a full `/legal` surface (Terms, Privacy, Acceptable Use,
  Cookies, Subprocessors, DPA, Refund), text-first with no decorative icons.
- **Workspace suite** — the app is a Google-Workspace-style set of distinct
  products (Studio / Press / Ads / Suite) with an app switcher; each has its
  own dashboard and focused nav.

## Testing

`pytest` runs ~395 unit tests (stubbed pools) plus a real-Postgres
integration suite (`tests/integration/`) that exercises the money and admin
paths — credit-purchase idempotency, atomic debit + ledger, spend-cap
summation, append-only audit, and GDPR erasure cascade. The integration
tests skip when `MARKETER_DATABASE_URL` is unset and run automatically in CI
(which provisions Postgres). `sitemap.xml` + `robots.txt` ship for the
marketing site.

## Roadmap

Publishing integrations (WordPress, Ghost, Medium, Shopify, Dev.to),
Google Search Console-backed performance attribution, competitor
monitoring, topic clusters, per-client brand kits + team seats for
agencies, and semantic dedup memory.
