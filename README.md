# marketer.sh

Autonomous marketing platform for AI agents: one system that ideates,
produces, publishes, and learns from marketing content across formats.

Two production pipelines share the same niches, spend caps, billing,
and agent surfaces (REST API, Python SDK, CLI, MCP server):

- **Video** — hook-driven short-form video for TikTok / Reels / Shorts.
- **Articles** — SEO-optimized long-form written content: SERP research,
  structured outline, section-parallel writing, QA scoring, metadata +
  JSON-LD schema, hero image.

## Video pipeline

1. **Ideation** — pick a topic + write the hook
2. **Script** — break the topic into scenes (each scene = 1 image + 1 animation + caption beat)
3. **Visuals** — DALL-E 3 generates a keyframe per scene
4. **Animation** — Grok Imagine animates each keyframe into a short clip
5. **Voiceover** — TTS narrates the script
6. **Music** — background track is picked + ducked under VO
7. **Edit** — clips, VO, music are stitched with ffmpeg
8. **Captions** — Whisper transcribes the VO; captions are burned in
9. **QA** — automated checks on duration, audio levels, caption sync
10. **Publish** — schedule to TikTok / Reels / Shorts

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

## Roadmap (article platform, phase 2)

Ported from the upstream written-content system and planned next:
publishing integrations (WordPress, Ghost, Medium, Shopify, Dev.to),
Google Search Console-backed performance attribution, competitor
monitoring, topic clusters, autopilot content calendars, newsletter
digests, and semantic dedup memory.
