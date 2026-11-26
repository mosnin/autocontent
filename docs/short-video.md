# Short video (topic → finished vertical video)

A second way to make short-form video. The playbook pipeline (`src/marketer/pipeline.py`) generates every frame with
AI and posts on a schedule. Short video takes a topic or a finished script and builds the video from stock footage,
the person's own uploads, a voiceover, subtitles and music, in one to ten variants. The capability set comes from
MoneyPrinterTurbo (MIT, `harry0703/MoneyPrinterTurbo`); the code is ours, written for Marketer's stack, money rules
and design system. Where we adapted their logic the file says so in its header, and `THIRD_PARTY_NOTICES.md` carries
their licence.

This is not the "Story video" feature (multi-shot narrative from ViMax), which is a separate tool.

## What Marketer already had (mapped before building)

| Capability | Existing code | State before this change |
|---|---|---|
| Topic → script | `pipeline.py` stages 1-2: `run_ideation`, `run_scriptwriter`, hook gate, visual director | Yes, but only from a playbook (niche); no "type a topic" or "paste my script" path |
| Voiceover | `services/openai_tts.py`, `services/elevenlabs_tts.py`, `provider_fallback.synthesize_vo_with_fallback` | Yes (OpenAI and ElevenLabs, with fallback) |
| Footage | `openai_images.generate_keyframe` + image-to-video (`grok_imagine`, `fal_video`), avatar lip-sync | AI only. No stock footage, no uploaded footage |
| Uploads | `backend/routes/templates.py` (base64 product image for remixes) | Images for remixes only, 12 MB through the API; never used as footage. The web proxy caps bodies at 1 MB |
| Edit | `services/ffmpeg.concat_clips` (scale + pad), `settings.aspect` | Letterbox only, one global aspect, no clip duration (except `scene_max_duration_sec`), no speed, no transitions, no order |
| Subtitles | `openai_whisper.transcribe_word_level` → `services/subtitle.words_to_ass` → `ffmpeg.burn_subtitles` | One word on screen at a time, burned in. Style: font, size, colours, uppercase, position. No sidecar SRT/VTT, no lines, no highlighted word, no outline control, timing text is whatever Whisper heard |
| Music | `services/music.pick_track` (local + Pixabay Music), `music_gen.compose` (ElevenLabs), sidechain ducking in `ffmpeg.mix_audio` | Yes, but gain fixed at -18 dB per job, ducking always on, music only switchable per playbook |
| Batch variants | none | One job per playbook and platform |
| Per-stage progress | `JobStatus` on `jobs` | Yes for playbook videos |
| Spend | `SpendContext` (playbook cap, global cap, prepaid credit) in `spend_ledger` (numeric USD) | Yes; no per-batch cap, no integer metering, no idempotency per paid call |
| Library remix | `services/compose.py` | Concatenates existing clips |

## Gap list and what was built

| # | Gap | Built | Where |
|---|---|---|---|
| 1 | Stock footage: Pexels and Pixabay, keys server-side, attribution and licence per clip, search terms from the script, caching | Pexels and Pixabay video search (official APIs), smallest rendition that fills the canvas, download only from the providers' CDN hosts, 24 h search cache in Postgres (Pixabay's API terms ask for it) and a per-clip file cache. Each clip stores provider, id, page URL, creator, licence name and URL, and the search term. Search terms come from the script writer (one or two per sentence) or, for a pasted script, from a deterministic keyword extractor. Coverr is not built (optional) | `src/marketer/short_video/stock.py`, `keywords.py` |
| 2 | Uploaded images and videos as footage | Presigned PUT straight to object storage (the web proxy's 1 MB cap stays), then a server check: declared and stored size, magic bytes, `ffprobe` (streams, duration, dimensions), limits per kind. Rejected uploads are deleted. Images play with a slow zoom | `short_video/uploads.py`, `POST /short-videos/uploads`, `/uploads/{id}/complete` |
| 3 | Edit controls | Clip length, playback speed, transition (none, fade, fade in, fade out, shuffle), crop-to-fill or letterbox, random or sequential order, 9:16 / 16:9 / 1:1 per video. The clip plan is a pure function (adapted from MoneyPrinterTurbo's `combine_videos`): footage covers the narration plus a small margin, one slice per source before any repeats | `short_video/edit_plan.py`, `render.py` |
| 4 | Subtitles | Lines (sentence), one word at a time, or lines with the spoken word highlighted; font, size, position, colours, outline width, uppercase; burned in, sidecar SRT and VTT, or both. Timing is Whisper's word timing on our own voiceover, with the words replaced by the script's own words where they align (so names and numbers are spelled as written) | `short_video/captions.py` |
| 5 | Music | None, library (local + Pixabay Music) or generated (ElevenLabs), volume per video, ducking under the voice on or off | `short_video/render.py` (mix), `pipeline.py` (selection) |
| 6 | Batch variants | 1 to 10 variants per topic: each gets its own hook and script (topic source) and its own footage order and picks. Per-item status and stage. A batch cap (default 1.5x the estimate) on top of the playbook, global and credit caps. Batches over 3 variants or over $5 estimated wait for a person's approval | `short_video/pipeline.py`, `repos/short_videos.py`, rails action `content.short_video.batch.approve` |

## Money

- Every paid call (script, voiceover, transcription, generated music) runs through `short_video/metering.py`: an
  idempotency key per item attempt and stage (`sv:{item}:{attempt}:{stage}`) is claimed in `short_video_charges`
  before the call, the cost is recorded in integer micro-dollars (`cost_micros`, rounded up), and a replay of a
  finished key does not call the provider again. A key left `pending` by a crash is an unknown outcome: the item stops
  and asks for a retry, which uses a new attempt number. It is never re-run silently.
- The same calls still write `spend_ledger` through `SpendContext`, so playbook, global and prepaid-credit caps apply
  exactly as for every other pipeline.
- Stock footage and uploads cost nothing.
- Estimates (`POST /short-videos/estimate`) use the providers' pricing tables already in the repo.

## Rails and permissions

| Route | Permission | Notes |
|---|---|---|
| `GET /short-videos/options` | `content:read` | Defaults, voices, which footage sources and music modes are configured, limits |
| `POST /short-videos/estimate` | `content:read` | No side effects |
| `GET /short-videos`, `GET /short-videos/{id}` | `content:read` | |
| `POST /short-videos` | `content:create` | Spends content credits (MEDIUM). Large batches park in `awaiting_approval` |
| `POST /short-videos/{id}/approve` | `content:approve` | A person only (agents and tokens get 403). `enforce_dispatch("content.short_video.batch.approve")`: HIGH, stopped by the `spend` and `all` kill switches, bound to the batch's argument hash |
| `POST /short-videos/{id}/cancel` | `content:create` | Reduces exposure |
| `POST /short-videos/items/{id}/retry` | `content:update` | New attempt number |
| `GET /short-videos/items/{id}/video`, `/subtitles` | `content:read` | mp4, SRT or VTT |
| `POST /short-videos/uploads`, `/uploads/{id}/complete`, `GET /short-videos/uploads` | `content:create` / `content:read` | |
| `GET /short-videos/footage/search` | `content:read` | Free search preview with attribution |

Agent tools (content producer): `create_short_video` (MEDIUM, same as `create_video`), `list_short_videos` and
`get_short_video` (LOW). The agent cannot approve a large batch; the approve route refuses non-person callers.

## Observability

`pipeline.short_video.run` (root, `tenant_id`, `agent=short_video_pipeline`, Braintrust `task`) and
`pipeline.short_video.stage.<stage>` spans. Model calls inside use the existing GenAI spans (`chat …`, `gen_ai.speech`,
`gen_ai.transcription`, `gen_ai.music`). Search terms and stock URLs are not put on spans.

## UI

`/content/short` (entry: a "Short video" button on Content). One decision per step: topic or script → look and
voice → footage → subtitles and music → variants → render, with defaults so the first step's button is enough.
Everything else lives in one "Fine-tune" sheet. Batches show each variant's stages as they run.
Previews: `/preview/app/content/short`, `…/short/fine-tune`, `…/short/batch`, `…/short/approval`.

## Open points

- Uploads need CORS on the bucket for browser PUTs (`PUT` from the web origin, `Content-Type` header).
- Uploads are validated structurally (magic bytes, `ffprobe`, limits) and re-encoded before use; there is no malware
  scanner in the stack.
- Coverr, AI-generated footage per segment and posting a finished short video are not built. Finished videos land in
  the media library (`final`) and can be scheduled from there later.
