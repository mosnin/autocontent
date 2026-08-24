# @marketer/sdk

Typed TypeScript client for the [marketer.sh](https://marketer.sh) public API.

- **Auth**: personal access token (PAT, `mkt_...`) sent as `Authorization: Bearer <token>`.
- **Types**: generated straight from the exported OpenAPI spec (`docs/api/openapi.json`) via [`openapi-typescript`](https://openapi-ts.dev/), re-exported as `paths` / `components` alongside a hand-written, typed `MarketerClient`.
- **Errors**: every non-2xx response is parsed into the structured error envelope (`{ error: { code, message, hint, retryable, details } }`) and thrown as `MarketerApiError` — see [`docs/api/errors.md`](../../docs/api/errors.md).

This package lives at `packages/ts-sdk` (not under `web/`, which is the Next.js app) so it can be published independently and consumed by any TypeScript project, not just the dashboard.

## Install

Not yet published to a registry. Consume it from within this monorepo (workspace dependency), or pack it locally:

```bash
cd packages/ts-sdk
npm install
npm run build     # emits dist/
npm pack          # produces marketer-sdk-0.1.0.tgz you can `npm install /path/to/it` elsewhere
```

## Regenerating types

The spec must exist first — from the repo root:

```bash
uv run python scripts/export_openapi.py   # writes docs/api/openapi.json
cd packages/ts-sdk
npm run generate                          # openapi-typescript -> src/types.ts
npm run build
```

Re-run `generate` whenever a route changes; commit the regenerated `src/types.ts` alongside `docs/api/openapi.json` so they never drift apart.

## Quickstart: create a niche, enqueue a job, poll it

```ts
import { MarketerClient } from "@marketer/sdk";

const client = new MarketerClient({
  baseUrl: process.env.MARKETER_API_BASE_URL ?? "https://api.marketer.sh",
  token: process.env.MARKETER_API_TOKEN!, // mkt_...
});

// 1. Create a niche (a content channel: voice, visual style, posting
//    windows, daily spend cap, ...). See docs/api/quickstart.md for the
//    full field list — NicheCreate is large, every field is required.
const niche = await client.createNiche({
  title: "Stoic Wisdom Shorts",
  description: "Bite-sized stoic philosophy for short-form video.",
  target_audience: "18-34, self-improvement minded",
  hashtags: ["#stoicism", "#selfimprovement"],
  visual_style: "moody cinematic, warm tones",
  voice: "calm, authoritative narrator",
  target_duration_sec: 30,
  scene_count: 6,
  posting_windows: [{ hour: 9, minute: 0, tz: "America/Los_Angeles" }],
  platforms: ["tiktok", "reels", "shorts"],
  daily_spend_cap_usd: "5.00",
  image_quality: "medium",
  video_resolution: "480p",
  scene_max_duration_sec: 5,
  approve_before_post: false,
  video_provider: "grok",
  fal_model: "",
  script_model: "",
  voice_provider: "openai",
  elevenlabs_voice_id: "",
  music_provider: "auto",
});

// 2. Enqueue a pipeline run for the niche. Pass an idempotency key (a
//    UUID you generate once) so a network timeout can be safely retried
//    without risking a duplicate — see docs/api/idempotency.md.
const job = await client.enqueueJob(
  { niche_id: niche.id, platform: "tiktok" },
  { idempotencyKey: crypto.randomUUID() }
);
console.log(`queued job ${job.id}, status=${job.status}`);

// 3. Poll until it finishes (or fails / needs approval).
const finished = await client.waitForJob(job.id, { intervalMs: 5_000 });
console.log(`job ${finished.id} finished with status=${finished.status}`);

// Errors: branch on `.code`/`.retryable`, not on prose or HTTP status.
import { MarketerApiError } from "@marketer/sdk";

try {
  await client.getNiche("not-a-real-id");
} catch (err) {
  if (err instanceof MarketerApiError) {
    console.error(err.code, err.message, "retryable:", err.retryable);
  } else {
    throw err;
  }
}
```

## Escape hatch: `client.request()`

Named methods (`listNiches`, `enqueueJob`, `waitForJob`, ...) cover the flows above; everything else in the API is reachable via the generic, still-typed `request()`:

```ts
import type { components } from "@marketer/sdk";

type BrandKit = components["schemas"]["BrandKit"];

const kit = await client.request<BrandKit>("GET", "/api/v1/brand-kit");
```

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit, sanity-checks src/ against src/types.ts
npm run build       # emits dist/ (ESM + .d.ts)
```
