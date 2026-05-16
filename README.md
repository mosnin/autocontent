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

## Layout

```
src/autocontent/
  config.py            # env + settings
  pipeline.py          # end-to-end run() entrypoint
  orchestrator.py      # OpenAI Agents SDK wiring
  agents/              # one agent per pipeline stage
  services/            # provider clients (DALL-E, Grok, ffmpeg, ...)
  models/              # pydantic schemas (Idea, Scene, Clip, Job, ...)
  storage/             # Modal volume + job store
modal_app.py           # Modal app entry (functions, schedules)
```
