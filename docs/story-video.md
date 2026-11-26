# Story video

A story video turns an idea or a finished script into a short multi-shot film. A person reviews the script and
then the storyboard before anything expensive renders. The stage design and the prompts are adapted from
[ViMax](https://github.com/HKUDS/ViMax) (MIT, see `THIRD_PARTY_NOTICES.md`). The orchestration, checkpoints,
metering, providers and UI are ours.

## The flow

```
 idea ──► story ──► scenes ──► (person reviews / edits / revises with a note)
 script ────────────► scenes ─┘
                                 │  "Draw the storyboard"
                                 ▼
          characters ──► reference portrait per visible character
                    └──► shots per scene (first frame + motion + narration)
                                 └──► first frame per shot, drawn against the portrait of a character in it
                                 │  (person reviews; can redraw any shot, with or without a new description)
                                 ▼  "Render"  (estimate ≥ approval line → waits for spend:approve)
          clip per shot (image-to-video from its frame) ──► ffmpeg concat ──► final video
```

| Status | Means | Next |
|---|---|---|
| `writing` | the script stage is running (`script` or `revise`) | `script_ready` |
| `script_ready` | waiting on the person | edit, revise, or draw the storyboard |
| `boarding` | the storyboard stage is running (`storyboard`, or `frame` for one redraw) | `storyboard_ready` |
| `storyboard_ready` | waiting on the person | redraw shots, or render |
| `awaiting_approval` | the estimate is at or above the approval line | approve (spend:approve) or decline |
| `rendering` | clips and the final cut are being made | `done` |
| `done` | the video exists; shots can still be redrawn (which re-opens the storyboard) | |
| `failed` | a stage stopped; `stage` says which, `error` says why | Resume |

## What was ported, and what was rewritten

| ViMax | Here |
|---|---|
| `Screenwriter.develop_story`, `write_script_based_on_story` | `prompts.DEVELOP_STORY_*`, `WRITE_SCENES_*` (adapted text; JSON shapes instead of LangChain format instructions; scene budget) |
| `CharacterExtractor` | `prompts.EXTRACT_CHARACTERS_*` (adapted; adds `visible` handling, character budget) |
| `StoryboardArtist.design_storyboard` + `decompose_visual_description` | merged into one call per scene, `prompts.DESIGN_SHOTS_*` (first frame, motion, narration, visible characters) |
| `CharacterPortraitsGenerator` (front, side, back) | front portrait only, `prompts.PORTRAIT_PROMPT`; gpt-image-1 takes one reference image per call, so one canonical portrait is what we can use |
| Camera tree, transition videos, best-image selector (N candidates + a VLM judge) | not ported: they multiply image spend; a person picks instead, with per-shot redraw |
| File checkpoints in a working directory | `story_checkpoints` rows, keyed by the revision of everything that shaped the unit |
| Agent loop for revisions | `revise` stage (a note rewrites the scenes into a new revision), and the agent tools below |
| Web UI, TUI, provider presets | not used: Marketer's own screens, providers and job system |

No ViMax file was copied whole. `src/marketer/story/prompts.py` carries the MIT header for the adapted prompt
text.

## Code

| Piece | File |
|---|---|
| Models, checkpoint keys, micro-dollar helpers | `src/marketer/story/models.py` |
| Stage orchestration, resume | `src/marketer/story/pipeline.py` (`run_stage`) |
| Operations behind every route (status claims, approval, spawn) | `src/marketer/story/service.py` |
| Metering | `src/marketer/story/meter.py` |
| Providers seam | `src/marketer/story/providers.py` (`StoryProviders`, `DefaultProviders`) |
| Persistence | `src/marketer/story/store.py`, `db/migrations/0036_story_videos.sql` (+ rollback) |
| Settings | `src/marketer/story/settings.py` (`MARKETER_STORY_*`) |
| Routes | `backend/routes/stories.py`, classified in `backend/policy.py` |
| Background job | `modal_app.py::run_story_stage` |
| Agent tools | `agent/src/marketer/tools/content.ts`, permissions in `agent/src/marketer/tools/permissions.ts` |
| UI | `web/components/app/stories/*`, `web/app/(app)/content/stories/*`; previews at `/preview/app/content/stories/*` |

## Providers

- **Text**: OpenRouter, `MARKETER_STORY_TEXT_MODEL` (default `anthropic/claude-sonnet-4.5`, must be in the curated
  registry in `services/openrouter.py` so it is priceable), chat completions in JSON mode. Without an OpenRouter key
  the stages run on the OpenAI `agent_model`.
- **Images**: `services/openai_images.generate_keyframe` (gpt-image-1), quality `MARKETER_STORY_IMAGE_QUALITY`.
  Consistency: every frame is drawn with the portrait of the first listed character in that shot as the reference
  image, and the frame prompt restates every visible character's features.
- **Video**: `services/grok_imagine.animate` by default, or `services/fal_video.animate` with
  `MARKETER_STORY_VIDEO_PROVIDER=fal` and `MARKETER_STORY_FAL_MODEL`. Each sits behind `provider_limits.slot`.
- **Assembly**: `services/ffmpeg.concat_clips` (silent concat; see open questions).

## Money

- **Micro-dollars.** Every charge is stored in `story_charges.cost_micros` (bigint) and summed into
  `story_videos.spent_micros`. Conversion rounds half up (`models.usd_to_micros`); no float touches money.
- **Idempotency.** Every paid call runs inside `meter.unit(<checkpoint key>, <stage>)`; its charge key is
  `story:{story_id}:{checkpoint key}#{n}` and is unique per workspace. The spend_ledger row (and the credit debit)
  is written only when the charge row is new. A worker that crashed after the provider charged but before the
  checkpoint landed replays the unit: the provider runs again (we absorb that), the workspace is not charged again.
- **Caps.** Before each paid call: the story's own ceiling (`MARKETER_STORY_MAX_USD`, default $25), then the usual
  `SpendContext` checks (playbook daily cap when the story names a playbook, the workspace's global daily cap,
  prepaid credit). After each charge `SpendContext.log` re-checks them as it does for every pipeline. A cap stops
  the stage as `failed` with "Stopped at a spend limit: …"; Resume continues once there is room.
- **Approval for large renders.** `POST /render` with an estimate at or above `MARKETER_STORY_APPROVAL_USD`
  (default $5) parks the story in `awaiting_approval` and stores the hash of the render's arguments (story,
  revision, each shot's frame revision, the estimate). `POST /render/approve` needs `spend:approve` and runs through
  the rails enforcement point as `content.story.render` (HIGH, kill switch scope `spend`): a kill switch blocks it,
  a storyboard changed since the request fails the argument binding (409), and the dispatch is recorded in
  `rails_executions`. A render that would pass the story ceiling is refused up front (402).

## Resume

A unit of work (a story, the scenes, the characters, one scene's shots, a portrait, a frame, a clip, the final cut)
is skipped when its checkpoint exists and, if it names a file, the file is still there. Keys embed revisions:
editing or revising the script bumps `revision` (so characters, shots, portraits and frames are made again), and a
per-shot redraw bumps that shot's `frame_rev` (so only its frame and clip are made again). A failed stage keeps its
name in `stage`; `POST /retry` runs it again.

## Observability

Each background stage opens a root span `pipeline.story.run.<stage>` (Braintrust `task`, `tenant_id`, `agent =
story_video`, `marketer.story_id`) and child spans `pipeline.story.<step>`. Text calls are GenAI `chat {model}` spans
with tokens, cost and `marketer.story.stage`; image and video calls keep the spans their services already emit.
Content follows the workspace's content mode like every other GenAI span.

## API

All under `/api/v1/stories`. Reads need `content:read`; writes `content:create`; approving a render `spend:approve`.

| Method and path | Does |
|---|---|
| `GET /` · `GET /{id}` | list (summaries) · one story (scenes, characters, shots with `frame_ready` / `clip_ready`, estimate, spend; never a file path) |
| `POST /` | `{mode, source, requirement?, style?, aspect?, title?, niche_id?}` → 202, starts the script stage |
| `PUT /{id}/script` | replace the scenes (new revision; the storyboard is planned again) |
| `POST /{id}/script/revise` | `{note}` → 202, rewrites the scenes into a new revision |
| `POST /{id}/storyboard` | → 202 |
| `POST /{id}/shots/{idx}/regenerate` | `{first_frame?, motion?}` → 202, redraws one shot |
| `POST /{id}/render` | → 202 `rendering`, or 202 `awaiting_approval` |
| `POST /{id}/render/approve` · `/render/decline` | execute or drop a pending render approval |
| `POST /{id}/retry` | resume a failed stage |
| `GET /{id}/shots/{idx}/frame` · `/characters/{idx}/portrait` · `/video` | files |

Every write that starts work first wins an atomic status transition, so double clicks and agent replays start it
once (409 otherwise).

## Agent tools

The content producer holds `list_story_videos`, `get_story_video` (LOW, `content:read`) and `start_story_video`,
`revise_story_video`, `storyboard_story_video`, `render_story_video` (MEDIUM, `content:create`). No tool approves a
render: a large render comes back `awaiting_approval` and the person approves it in Content.

## Tests

`tests/test_story_pipeline.py` (orchestration with fake providers, consistency references, resume after a failed
shot, replay never charged twice, story ceiling, global cap, micro-dollar rounding),
`tests/test_story_routes.py` (permissions per role, status races, approval through the rails, kill switch, argument
binding, ceiling, spawn failure, files), `tests/test_story_providers.py` (OpenRouter call, GenAI span, metering,
stage spans), `tests/integration/test_pg_story.py` (real Postgres: scoping, one winner per claim, checkpoints,
idempotent charges); `agent/test/marketer-tools.test.ts` (risk tiers, request mapping, validation);
`web/test/story-steps.test.ts`.

## Open questions

- **Sound.** Clips are concatenated silently. Options: narration through the existing TTS + `ffmpeg.mix_audio`
  (the shots already carry a `narration` line), music through `services/music`, or keeping the video model's own
  audio (`concat_clips(keep_audio=True)` when every clip has a stream).
- **Approval in the inbox.** A pending render shows on the story page only; it is not yet an item in
  `GET /workspace/inbox`.
- **Multi-reference consistency.** Frames with two characters use one reference portrait. A provider that accepts
  several reference images (or the gpt-image-1 multi-image edit) would keep both on-model.
- **Spend attribution.** spend_ledger rows from a story carry no story id (story_charges does). Adding
  `spend_ledger.story_id` would let the spend pages group by story.
- **Reaping.** A worker that dies mid-stage leaves the story busy; after 45 minutes without progress `POST /retry`
  accepts it (`service.STALE_AFTER`). The scheduled reaper (`reap_stale_jobs`) does not sweep this table yet.
