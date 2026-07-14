# autocontent

Autonomous short-form content creation system optimized for hook-driven, educational content.

## Pipeline

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

## Stack

- **Orchestration**: OpenAI Agents SDK (multi-agent handoffs)
- **Runtime**: Modal (serverless GPU + scheduled jobs + volumes)
- **Image gen**: OpenAI DALL-E 3
- **Animation**: Grok Imagine (xAI)
- **TTS**: OpenAI TTS
- **Transcription**: OpenAI Whisper
- **Video**: ffmpeg
- **Storage**: Modal volumes for clips/assets, SQLite metadata

## Multi-tenant

Every user is a Clerk identity. Per-user records (`niches`, `jobs`,
`spend_ledger`) live in Supabase Postgres. Posting goes through one
Ayrshare account using per-user profile keys. Artifacts on the Modal
volume are partitioned by `user_id`. Each niche has its own daily spend
cap that the pipeline checks before every credit-spending stage.

## Layout

```
src/autocontent/
  config.py            # env + settings (db url, clerk, secrets)
  db.py                # asyncpg pool
  pipeline.py          # run_job(user_id, niche_id, platform)
  orchestrator.py      # OpenAI Agents SDK wiring
  agents/              # one agent per LLM stage
  services/            # provider clients (DALL-E, Grok, ffmpeg, ...)
  models/              # pydantic schemas (User, Niche, Job, SpendEntry, ...)
  repos/               # asyncpg repositories (users, niches, jobs, spend)
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
# 1. Apply schema
psql "$AUTOCONTENT_DATABASE_URL" -f db/migrations/0001_init.sql

# 2. Deploy Modal app (pipeline + FastAPI)
modal deploy modal_app.py

# 3. Start web UI
cd web && npm install && npm run dev
```
