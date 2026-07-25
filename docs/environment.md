# Environment and datastores

Generated from `src/marketer/config.py` (the single source of truth for
backend settings), `modal_app.py`, and the web app's own `process.env`
reads. If a variable is not listed here, nothing reads it.

## Datastores

| Store | What | How it's reached |
|---|---|---|
| **Neon Postgres** | Every row: users, niches, jobs, articles, campaigns, ads, spend ledger, media index, studio generations. | `asyncpg` pool (`src/marketer/db.py`), `MARKETER_DATABASE_URL`. The `-pooler` endpoint is PgBouncer in transaction mode; `db.py` detects that and sets `statement_cache_size=0`, which is what makes it safe for asyncpg. |
| **Modal Volumes** | `marketer-artifacts` (renders in flight), `marketer-assets` (static inputs). Ephemeral working storage, not a library. | Mounted at `/artifacts` and `/assets`. |
| **Wasabi (S3-compatible)** | Durable media library + Studio outputs and reference uploads. Optional; without it media stays on the volume and does not survive a recycle. | `boto3`, `MARKETER_WASABI_*`. |
| **Redis** | Distributed rate-limit buckets only. Optional — falls back to in-process memory, which is correct for a single instance. | `MARKETER_RATE_LIMIT_REDIS_URL`. |

Migrations are plain SQL in `db/migrations/`, applied by
`scripts/migrate.py`, each with a `.rollback.sql`. The only extension
enabled today is `pgcrypto` (0001). **Note:** the memory/knowledge phases
in the orchestration plan assume `pgvector`; it is not enabled yet and
will need its own migration.

---

## Backend — `MARKETER_*` (77 settings)

`Settings` uses `env_prefix="MARKETER_"`, so **every** field below is read
as `MARKETER_<UPPERCASE_FIELD>`. Values with a default are optional.

### Required to boot

| Variable | Default | Notes |
|---|---|---|
| `MARKETER_DATABASE_URL` | — | Neon pooled endpoint. Nothing works without it. |
| `MARKETER_CLERK_JWKS_URL` | — | JWT verification. |
| `MARKETER_CLERK_ISSUER` | — | JWT verification. |
| `MARKETER_CLERK_AUDIENCE` | `""` | Set in production, or tokens minted for another frontend on the same Clerk instance are accepted. |

### Core AI

| Variable | Default | Notes |
|---|---|---|
| `MARKETER_OPENAI_API_KEY` | `""` | Images, TTS, Whisper, article hero images. |
| `MARKETER_AGENT_MODEL` | `gpt-5.4-mini` | Pinned so LLM COGS is priceable. |
| `MARKETER_ARTICLE_WRITER_MODEL` | `gpt-5.4-mini` | Long-form drafting. |
| `MARKETER_OPENROUTER_API_KEY` | `""` | Alternate LLM routing. |
| `MARKETER_EXA_API_KEY` | `""` | SERP research. Unset degrades to model knowledge rather than failing. |

### Media generation providers

| Variable | Default | Notes |
|---|---|---|
| `MARKETER_FAL_API_KEY` | `""` | **All 127 Studio models plus scene animation.** |
| `MARKETER_XAI_API_KEY` | `""` | Grok Imagine video. |
| `MARKETER_ELEVENLABS_API_KEY` | `""` | Voiceover + music. |
| `MARKETER_ELEVENLABS_MODEL_ID` | `eleven_multilingual_v2` | |
| `MARKETER_ELEVENLABS_DEFAULT_VOICE_ID` | `21m00Tcm4TlvDq8ikWAM` | ElevenLabs' stock narrator. |
| `MARKETER_PIXABAY_API_KEY` | `""` | Stock music. |
| `MARKETER_FAL_PRICE_OVERRIDES` | `""` | JSON `{model_id: usd_per_unit}` — correct price drift without a deploy. |
| `MARKETER_STUDIO_MODEL_REGISTRY_EXTRA` | `""` | JSON array of extra Studio model entries. |

### Publishing

| Variable | Default | Notes |
|---|---|---|
| `MARKETER_ZERNIO_API_KEY` | `""` | Zernio posting, profiles, and analytics. The only publishing integration. |
| `MARKETER_ZERNIO_WEBHOOK_SECRET` | `""` | Hex HMAC-SHA256 for `X-Zernio-Signature`; empty ⇒ `/webhooks/zernio` returns 503, so publish outcomes and account disconnects never reach us. |

### Object storage (Wasabi)

| Variable | Default |
|---|---|
| `MARKETER_WASABI_ENABLED` | `false` |
| `MARKETER_WASABI_ENDPOINT_URL` | `https://s3.us-east-1.wasabisys.com` |
| `MARKETER_WASABI_REGION` | `us-east-1` |
| `MARKETER_WASABI_BUCKET` | `""` |
| `MARKETER_WASABI_ACCESS_KEY_ID` | `""` |
| `MARKETER_WASABI_SECRET_ACCESS_KEY` | `""` |
| `MARKETER_WASABI_PRESIGN_EXPIRY_SEC` | `3600` |

### Billing (prepaid credits)

| Variable | Default | Notes |
|---|---|---|
| `MARKETER_BILLING_ENABLED` | `false` | Off ⇒ self-hosted on your own keys, spend caps only. |
| `MARKETER_BILLING_MARGIN` | `1.5` | Debit multiplier over raw provider cost. |
| `MARKETER_STRIPE_SECRET_KEY` | `""` | |
| `MARKETER_STRIPE_WEBHOOK_SECRET` | `""` | `checkout.session.completed`. |
| `MARKETER_APP_URL` | `""` | Checkout redirects and email links. |

### x402 (on-chain top-ups)

| Variable | Default |
|---|---|
| `MARKETER_X402_ENABLED` | `false` |
| `MARKETER_X402_NETWORK` | `base` |
| `MARKETER_X402_ASSET` | `""` |
| `MARKETER_X402_ASSET_NAME` | `USDC` |
| `MARKETER_X402_ASSET_VERSION` | `2` |
| `MARKETER_X402_PAY_TO` | `""` |
| `MARKETER_X402_FACILITATOR_URL` | `https://x402.org/facilitator` |
| `MARKETER_X402_MIN_TOPUP_USD` | `1.0` |
| `MARKETER_X402_MAX_TOPUP_USD` | `1000.0` |

### Ads

| Variable | Default | Notes |
|---|---|---|
| `MARKETER_ADS_ENABLED` | `false` | |
| `MARKETER_ADS_APPROVAL_THRESHOLD_USD` | `50.0` | Above this, an action needs sign-off. |
| `MARKETER_COMPOSIO_API_KEY` | `""` | OAuth broker for ad platforms. |
| `MARKETER_COMPOSIO_GOOGLEADS_AUTH_CONFIG_ID` | `""` | |
| `MARKETER_COMPOSIO_METAADS_AUTH_CONFIG_ID` | `""` | |

### Workflow engine (Inngest)

| Variable | Default |
|---|---|
| `MARKETER_INNGEST_SIGNING_KEY` | `""` |
| `MARKETER_INNGEST_EVENT_KEY` | `""` |
| `MARKETER_INNGEST_DEV` | `false` |

### Email

| Variable | Default |
|---|---|
| `MARKETER_RESEND_API_KEY` | `""` (empty ⇒ notifications silently skipped) |
| `MARKETER_EMAIL_FROM` | `marketer <notifications@marketer.dev>` |

### Observability

| Variable | Default |
|---|---|
| `MARKETER_SENTRY_DSN` | `""` (empty disables Sentry) |
| `MARKETER_SENTRY_ENVIRONMENT` | `production` |
| `MARKETER_SENTRY_TRACES_SAMPLE_RATE` | `0.0` |
| `MARKETER_OTEL_EXPORTER_OTLP_ENDPOINT` | `""` (empty disables OTEL entirely) |
| `MARKETER_OTEL_SERVICE_NAME` | `marketer-sh` |
| `MARKETER_OTEL_EXPORTER_OTLP_HEADERS` | `""` |
| `MARKETER_OTEL_TRACES_SAMPLE_RATE` | `1.0` |
| `MARKETER_PREFLIGHT_STRICT` | `false` (true ⇒ boot fails on a config ERROR) |

### Networking and limits

| Variable | Default | Notes |
|---|---|---|
| `MARKETER_WEB_ORIGIN` | `""` | Comma-separated CORS allow-list; empty ⇒ `*` with credentials off. |
| `MARKETER_RATE_LIMIT_REDIS_URL` | `""` | |
| `MARKETER_TRUSTED_PROXY_HOPS` | `1` | Modal ingress = 1. Raise only for more trusted layers. |

### Pipeline tuning

| Variable | Default |
|---|---|
| `MARKETER_ASPECT` | `9:16` |
| `MARKETER_ARTIFACTS_DIR` | `/artifacts` |
| `MARKETER_ASSETS_DIR` | `/assets` |
| `MARKETER_ARTICLE_HERO_IMAGE` | `true` |
| `MARKETER_IDEATION_CANDIDATES` | `3` (1 = single-shot, no judge call) |
| `MARKETER_SCENE_FANOUT_LIMIT` | `4` |
| `MARKETER_PIPELINE_GLOBAL_CONCURRENCY` | `20` |
| `MARKETER_PIPELINE_PER_USER_CONCURRENCY` | `3` |
| `MARKETER_PIPELINE_PER_NICHE_CONCURRENCY` | `1` (serializes to prevent character-sheet races) |
| `MARKETER_CAMPAIGN_EST_COST_PER_PIECE_USD` | `2.50` |

### Provider concurrency (bulkheads)

| Variable | Default |
|---|---|
| `MARKETER_FAL_MAX_CONCURRENCY` | `16` |
| `MARKETER_ELEVENLABS_MAX_CONCURRENCY` | `8` |
| `MARKETER_OPENAI_IMAGES_MAX_CONCURRENCY` | `24` |
| `MARKETER_OPENAI_TTS_MAX_CONCURRENCY` | `16` |
| `MARKETER_GROK_MAX_CONCURRENCY` | `8` |
| `MARKETER_PROVIDER_MAX_CONCURRENCY_OVERRIDES` | `""` (JSON map, e.g. `{"fal": 8}`) |

---

## Unprefixed variables

These are read by third-party SDKs directly, **not** by `Settings`:

| Variable | Read by |
|---|---|
| `OPENAI_API_KEY` | the OpenAI Agents SDK (ideation, scriptwriter, visual director, QA, niche draft) |

See "Known gaps" below — this one is easy to get wrong.

---

## Web (Next.js / Vercel)

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | yes | Needed at build time. |
| `CLERK_SECRET_KEY` | yes | Used by `middleware.ts`. |
| `NEXT_PUBLIC_API_BASE_URL` | yes | FastAPI origin the `/api/proxy` route forwards to. |
| `NEXT_PUBLIC_SITE_URL` | no | Canonical URLs / sitemap. |

---

## Known gaps

Three things that are currently wrong or incomplete, found while
enumerating this. None is fixed here — flagging only.

1. **`.env.example` lists `OPENAI_API_KEY`, `XAI_API_KEY`, and
   `XAI_API_KEY` unprefixed.** Because of `env_prefix="MARKETER_"`,
   those do **not** populate `Settings`. Verified:

   ```
   OPENAI_API_KEY=x        -> settings.openai_api_key == ''
   MARKETER_XAI_API_KEY=x  -> settings.xai_api_key    == 'x'
   ```

   Consequence: with only the unprefixed form set, the Agents SDK stages
   work (the SDK reads the env var itself) while `openai_images`,
   `openai_tts`, and `openai_whisper` get an empty key. **Both** forms of
   the OpenAI key need to be set today; xAI needs the `MARKETER_`-prefixed
   form only.

2. **`modal_app.py` mounts five secrets** — `marketer-openai`,
   `marketer-xai`, `marketer-zernio`, `marketer-fal`, `marketer-supabase`,
   `marketer-clerk`. Nothing in that list carries fal, ElevenLabs, Wasabi,
   Stripe, Composio, Resend, OpenRouter, Pixabay, Inngest, or x402 keys.
   Those features cannot run on Modal until their variables are added to
   an existing secret or a new secret is appended to the list. Studio in
   particular needs `MARKETER_FAL_API_KEY` there.

3. **`.env.example` covers 25 of 77 settings.** Everything under Studio,
   fal, ElevenLabs, Wasabi, x402, Composio/Ads, Inngest, OpenRouter, and
   the provider concurrency bulkheads is missing from it.

`services/preflight.py` already builds a boot-time config health report
per capability (OK / WARN / ERROR) and is reachable through the ops
endpoint — that is the fastest way to see which of these are actually
satisfied in a live deploy.
