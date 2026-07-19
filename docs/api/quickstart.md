# Quickstart

Create a niche (a content channel), enqueue a pipeline job, and poll it to completion — via raw curl, the Python SDK, and the TypeScript SDK.

Prerequisites: a personal access token (see [`authentication.md`](./authentication.md)) exported as `MARKETER_API_TOKEN`, and a base URL exported as `MARKETER_API_BASE_URL` (defaults used below: `http://localhost:8000` for local dev).

## 1. curl

```bash
export MARKETER_API_BASE_URL=http://localhost:8000
export MARKETER_API_TOKEN=mkt_your_token_here

# Create a niche. Every field below is required by the pipeline — a
# validation_failed (422) error's details.errors tells you which are missing.
NICHE=$(curl -sS -X POST "$MARKETER_API_BASE_URL/api/v1/niches" \
  -H "Authorization: Bearer $MARKETER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Stoic Wisdom Shorts",
    "description": "Bite-sized stoic philosophy for short-form video.",
    "target_audience": "18-34, self-improvement minded",
    "hashtags": ["#stoicism", "#selfimprovement"],
    "visual_style": "moody cinematic, warm tones",
    "voice": "calm, authoritative narrator",
    "target_duration_sec": 30,
    "scene_count": 6,
    "posting_windows": [{"hour": 9, "minute": 0, "tz": "America/Los_Angeles"}],
    "platforms": ["tiktok", "reels", "shorts"],
    "daily_spend_cap_usd": "5.00",
    "image_quality": "medium",
    "video_resolution": "480p",
    "video_provider": "grok",
    "voice_provider": "openai",
    "music_provider": "auto"
  }')
NICHE_ID=$(echo "$NICHE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
echo "created niche $NICHE_ID"

# Enqueue a pipeline run for it. Idempotency-Key makes a retried request
# (e.g. after a curl timeout) safe — see docs/api/idempotency.md.
JOB=$(curl -sS -X POST "$MARKETER_API_BASE_URL/api/v1/jobs" \
  -H "Authorization: Bearer $MARKETER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d "{\"niche_id\": \"$NICHE_ID\", \"platform\": \"tiktok\"}")
JOB_ID=$(echo "$JOB" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
echo "queued job $JOB_ID"

# Poll until it's done. status cycles through queued -> ideating -> scripting
# -> generating_images -> animating -> voicing -> editing -> captioning -> qa
# -> scheduling -> done (or failed / awaiting_approval / skipped).
until [ "$(curl -sS "$MARKETER_API_BASE_URL/api/v1/jobs/$JOB_ID" \
  -H "Authorization: Bearer $MARKETER_API_TOKEN" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')" != "queued" ]; do
  sleep 5
done
curl -sS "$MARKETER_API_BASE_URL/api/v1/jobs/$JOB_ID" -H "Authorization: Bearer $MARKETER_API_TOKEN"
```

Errors come back as `{"error": {"code": ..., "message": ..., "retryable": ...}}` — see [`errors.md`](./errors.md).

## 2. Python SDK

Uses `marketer.sdk.MarketerClient` (this repo's `src/marketer` package — install the repo or `pip install marketer-sh` once published). Full runnable version: [`examples/python_quickstart.py`](../../examples/python_quickstart.py).

```python
import asyncio
import os

from marketer.models import NicheCreatePayload, PostingWindow
from marketer.sdk import MarketerClient, MarketerError


async def main() -> None:
    async with MarketerClient(
        base_url=os.environ.get("MARKETER_API_BASE_URL", "http://localhost:8000"),
        token=os.environ["MARKETER_API_TOKEN"],
    ) as client:
        niche = await client.create_niche(
            NicheCreatePayload(
                title="Stoic Wisdom Shorts",
                description="Bite-sized stoic philosophy for short-form video.",
                target_audience="18-34, self-improvement minded",
                hashtags=["#stoicism", "#selfimprovement"],
                visual_style="moody cinematic, warm tones",
                voice="calm, authoritative narrator",
                target_duration_sec=30,
                scene_count=6,
                posting_windows=[PostingWindow(hour=9, minute=0, tz="America/Los_Angeles")],
                platforms=["tiktok", "reels", "shorts"],
                daily_spend_cap_usd="5.00",
            )
        )
        print(f"created niche {niche.id}")

        job = await client.enqueue_job(niche_id=niche.id, platform="tiktok")
        print(f"queued job {job.id}, status={job.status}")

        # Simple poll loop — see examples/python_quickstart.py for a version
        # with a timeout and backoff.
        while job.status.value == "queued":
            await asyncio.sleep(5)
            job = await client.get_job(job.id)
        print(f"job {job.id} now status={job.status}")


if __name__ == "__main__":
    asyncio.run(main())
```

`MarketerError` is raised on any non-2xx response — see [`errors.md`](./errors.md) for the envelope shape and a note on what it currently exposes.

## 3. TypeScript SDK

Uses `@marketer/sdk` ([`packages/ts-sdk`](../../packages/ts-sdk)).

```ts
import { MarketerClient, MarketerApiError } from "@marketer/sdk";

const client = new MarketerClient({
  baseUrl: process.env.MARKETER_API_BASE_URL ?? "http://localhost:8000",
  token: process.env.MARKETER_API_TOKEN!,
});

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
console.log(`created niche ${niche.id}`);

const job = await client.enqueueJob(
  { niche_id: niche.id, platform: "tiktok" },
  { idempotencyKey: crypto.randomUUID() }
);
console.log(`queued job ${job.id}, status=${job.status}`);

const finished = await client.waitForJob(job.id, { intervalMs: 5_000 });
console.log(`job ${finished.id} finished with status=${finished.status}`);
```

See [`packages/ts-sdk/README.md`](../../packages/ts-sdk/README.md) for install/build instructions and how `error instanceof MarketerApiError` handling works.

## 4. MCP (agent access)

An LLM agent can drive the exact same operations via the `marketer-mcp` server instead of writing code — see [`examples/mcp_agent.md`](../../examples/mcp_agent.md).
