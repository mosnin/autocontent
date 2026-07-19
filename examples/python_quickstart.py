#!/usr/bin/env python3
"""Runnable quickstart for the marketer.sh API using the Python SDK.

Creates a niche, enqueues a pipeline job for it, and polls the job until it
reaches a terminal status (or a timeout). Mirrors the curl / TypeScript
versions in docs/api/quickstart.md.

Usage:

    export MARKETER_API_BASE_URL=http://localhost:8000   # or https://api.marketer.sh
    export MARKETER_API_TOKEN=mkt_your_token_here
    uv run python examples/python_quickstart.py

Requires the marketer package to be importable (this repo installed, e.g.
via ``uv sync`` from the repo root — this script does not need the backend
or a database, only network access to a running API).
"""
from __future__ import annotations

import asyncio
import os
import sys
import time

from marketer.models import JobStatus, NicheCreatePayload, PostingWindow
from marketer.sdk import MarketerClient, MarketerError

# Job statuses that mean "the pipeline is done deciding what happens next" —
# stop polling once we reach one of these.
_TERMINAL_STATUSES = {
    JobStatus.done,
    JobStatus.failed,
    JobStatus.skipped,
    JobStatus.awaiting_approval,
}

_POLL_INTERVAL_SEC = 5.0
_POLL_TIMEOUT_SEC = 15 * 60.0


def _example_niche_payload() -> NicheCreatePayload:
    return NicheCreatePayload(
        title="Stoic Wisdom Shorts (SDK quickstart)",
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


async def _poll_job(client: MarketerClient, job_id) -> None:
    deadline = time.monotonic() + _POLL_TIMEOUT_SEC
    job = await client.get_job(job_id)
    while job.status not in _TERMINAL_STATUSES:
        if time.monotonic() > deadline:
            print(f"timed out waiting for job {job_id}; last status={job.status.value}", file=sys.stderr)
            return
        print(f"  job {job_id} status={job.status.value} ... polling again in {_POLL_INTERVAL_SEC:.0f}s")
        await asyncio.sleep(_POLL_INTERVAL_SEC)
        job = await client.get_job(job_id)
    print(f"job {job_id} finished with status={job.status.value}")
    if job.error:
        print(f"  error: {job.error}")
    if job.rendered:
        print(f"  rendered video: {job.rendered.path} ({job.rendered.duration_sec:.1f}s)")


async def main() -> int:
    try:
        async with MarketerClient(
            base_url=os.environ.get("MARKETER_API_BASE_URL", "http://localhost:8000"),
            token=os.environ["MARKETER_API_TOKEN"],
        ) as client:
            print("creating niche...")
            niche = await client.create_niche(_example_niche_payload())
            print(f"created niche {niche.id} ({niche.title!r})")

            print("enqueueing job...")
            job = await client.enqueue_job(niche_id=niche.id, platform="tiktok")
            print(f"queued job {job.id}, status={job.status.value}")

            await _poll_job(client, job.id)
    except KeyError as exc:
        print(f"missing required environment variable: {exc}", file=sys.stderr)
        return 1
    except MarketerError as exc:
        # exc.message is the raw response body (see docs/api/errors.md's
        # note on MarketerError not yet parsing the structured envelope).
        print(f"API error ({exc.status_code}): {exc.message}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
