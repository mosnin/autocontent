"""Modal app entrypoint.

Defines:
- `image`: container with ffmpeg + python deps
- `artifacts`, `assets`: volumes for per-job outputs and the music/font library
- `secrets`: API keys (OpenAI, xAI, Ayrshare)
- `run_pipeline`: one-shot per-job runner
- `nightly_batch`: scheduled cron that drains a queue of niches

Local dev: `modal run modal_app.py::run_pipeline --niche "personal finance"`
Deploy:    `modal deploy modal_app.py`
"""
from __future__ import annotations

import asyncio

import modal

APP_NAME = "autocontent"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install_from_pyproject("pyproject.toml")
    .add_local_python_source("autocontent")
)

artifacts = modal.Volume.from_name("autocontent-artifacts", create_if_missing=True)
assets = modal.Volume.from_name("autocontent-assets", create_if_missing=True)

secrets = [
    modal.Secret.from_name("autocontent-openai"),   # OPENAI_API_KEY
    modal.Secret.from_name("autocontent-xai"),      # XAI_API_KEY
    modal.Secret.from_name("autocontent-ayrshare"), # AYRSHARE_API_KEY
]

app = modal.App(APP_NAME, image=image, secrets=secrets)


@app.function(
    volumes={"/artifacts": artifacts, "/assets": assets},
    timeout=60 * 60,
)
async def run_pipeline(niche: str, platform: str = "tiktok") -> dict:
    from autocontent.pipeline import run_job

    job = await run_job(niche, platform=platform)
    artifacts.commit()
    return job.model_dump(mode="json")


@app.function(
    volumes={"/artifacts": artifacts, "/assets": assets},
    schedule=modal.Cron("0 13 * * *"),  # 13:00 UTC daily; tune later
    timeout=60 * 60 * 3,
)
async def nightly_batch() -> list[dict]:
    """Drain a static queue of niches once a day. Replace with a real queue."""
    niches = ["personal finance", "ai productivity", "history facts"]
    results = await asyncio.gather(*[run_pipeline.remote.aio(n) for n in niches])
    return results


@app.local_entrypoint()
def main(niche: str = "personal finance", platform: str = "tiktok"):
    result = run_pipeline.remote(niche, platform)
    print(result)
