"""One Planned Concept -> one Rendered Ad, plus the run-level fan-out.

This module is the only place that knows how to call an Image Model. The
catalog in `models.py` names providers; the adapter registry below turns
a name into a call. Swapping the catalog therefore touches two files, not
the planner, the repo, or the route.

Two behaviors are ported from Branda and are the reason the loop is
hand-rolled rather than a tenacity decorator:

* **Bounded transient retry with backoff.** A 429/5xx/timeout is retried
  twice; anything else fails immediately, because retrying a rejected
  prompt just spends the same money again.
* **One-time logo downgrade.** Some models advertise image input and
  then refuse the specific raster. A logo is enrichment, never a reason
  to lose the ad: on an image-input rejection we drop the logo, rebuild
  the prompt without the logo instruction, and try exactly once more.

Money: every generated image passes through `SpendContext` —
`ensure_can_spend` before the call, `log` immediately after it returns,
so a local decode failure can never undercount the ledger. The OpenAI
adapter delegates both to `services/openai_images.py`; the fal adapter
does it here against the pinned prices in `models.py`.
"""
from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import httpx

from ..config import settings
from ..logging import get_logger
from ..repos import ad_creatives as runs_repo
from ..services import ssrf
from ..services.spend_context import SpendContext
from ..storage import volume
from .concepts import PromptInput, build_concept_prompt, logo_instruction
from .models import (
    SQUARE_QUALITY,
    SQUARE_SIZE,
    ImageModel,
    image_model_by_id,
    image_price,
)
from .policy import fanout_limit
from .schemas import AdRunPlan, Brief, ConceptSubject, PlannedConcept

log = get_logger(__name__)

PROVIDER_FAL = "fal"
FAL_QUEUE_BASE = "https://queue.fal.run"
FAL_POLL_INTERVAL_SEC = 3.0
FAL_POLL_TIMEOUT_SEC = 300.0
HTTP_TIMEOUT_SEC = 60.0

# Two retries, then give up and let the Ad Slot be retried by hand. A
# longer ladder just burns the request budget of a provider that is
# already unhappy.
TRANSIENT_DELAYS = (0.8, 1.8)

# A brand logo is a small mark. Anything larger is either not a logo or
# not worth pushing through a provider's request body.
MAX_LOGO_BYTES = 4_000_000

_TRANSIENT_MARKERS = (
    "timeout",
    "timed out",
    "econn",
    "connection",
    "socket hang up",
    "network error",
    "rate limit",
    "too many requests",
    "temporarily",
)
_IMAGE_INPUT_MARKERS = (
    "image input",
    "input image",
    "image edit",
    "editing",
    "does not support image",
    "unsupported image",
    "invalid image",
    "image_url",
)


class RenderFailure(RuntimeError):
    """A render that did not produce an image.

    `retryable` distinguishes "the provider was busy" (worth a manual
    retry from the Gallery) from "this plan will never render".
    """

    def __init__(self, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable


def classify_failure(exc: BaseException, *, had_logo: bool) -> str:
    """`transient` | `image_input_rejected` | `nontransient`.

    Providers report a refused reference image a dozen different ways
    and several of them are 4xx codes that would otherwise read as
    permanent, so the logo case is checked first — and only when we
    actually sent a logo, or an unrelated 404 would trigger a pointless
    downgrade retry.
    """
    text = str(exc).lower()
    status = getattr(exc, "status_code", None) or getattr(
        getattr(exc, "response", None), "status_code", None
    )

    if had_logo and (status == 404 or any(m in text for m in _IMAGE_INPUT_MARKERS)):
        return "image_input_rejected"
    if isinstance(exc, (httpx.TimeoutException, httpx.ConnectError, asyncio.TimeoutError)):
        return "transient"
    if isinstance(status, int) and (status in (408, 409, 429) or status >= 500):
        return "transient"
    if any(marker in text for marker in _TRANSIENT_MARKERS):
        return "transient"
    return "nontransient"


# ── volume layout ─────────────────────────────────────────────────────────


def run_root(run_id: UUID | str) -> Path:
    """Each Ad Run gets its own directory under the artifacts volume, so a
    deleted run is one `rmtree` and a slot's PNG has a stable path the
    image endpoint can stream."""
    return volume.job_root(str(run_id)) / "creatives"


def slot_image_path(run_id: UUID | str, slot_id: UUID | str) -> Path:
    return run_root(run_id) / f"{slot_id}.png"


# ── logo loading ──────────────────────────────────────────────────────────


async def load_logo(url: str | None, dest: Path) -> Path | None:
    """Fetch the Brand's logo for use as a reference image, or None.

    The URL came from third-party research, so it gets the same
    public-host check as a user-registered webhook before we open a
    socket. Every failure returns None rather than raising: the ad
    renders without a logo, which is the whole point of the downgrade
    path existing further down.
    """
    if not url:
        return None
    try:
        ok, reason = await asyncio.to_thread(ssrf.check_public_url, url)
        if not ok:
            log.info("ad creative logo rejected", extra={"url": url, "reason": reason})
            return None
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SEC, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.content
        if not data or len(data) > MAX_LOGO_BYTES:
            return None
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        return dest
    except Exception as exc:  # noqa: BLE001 — enrichment, never fatal
        log.info("ad creative logo unavailable", extra={"url": url, "error": str(exc)})
        return None


# ── provider adapters ─────────────────────────────────────────────────────


@dataclass(slots=True)
class RenderRequest:
    model: ImageModel
    prompt: str
    logo_path: Path | None
    out_path: Path


async def _generate_openai(request: RenderRequest, *, spend: SpendContext | None) -> None:
    """OpenAI models go through the product's existing image path, which
    already meters against `openai_pricing.image_cost`."""
    from ..services import openai_images

    await openai_images.generate_keyframe(
        request.prompt,
        request.out_path,
        quality=SQUARE_QUALITY,
        size=SQUARE_SIZE,
        reference_image_path=request.logo_path,
        spend=spend,
    )


def _data_uri(path: Path) -> str:
    return f"data:image/png;base64,{base64.b64encode(path.read_bytes()).decode()}"


async def _fal_await_result(client: httpx.AsyncClient, queued: dict) -> dict:
    status_url = queued.get("status_url")
    response_url = queued.get("response_url")
    if not status_url or not response_url:
        raise RenderFailure(f"fal queue response missing urls: {queued!r}")
    deadline = asyncio.get_event_loop().time() + FAL_POLL_TIMEOUT_SEC
    while True:
        resp = await client.get(status_url)
        resp.raise_for_status()
        body = resp.json()
        state = body.get("status")
        if state == "COMPLETED":
            break
        if state in ("FAILED", "CANCELLED", "ERROR"):
            raise RenderFailure(f"fal request {state}: {body!r}")
        if asyncio.get_event_loop().time() >= deadline:
            raise RenderFailure(
                f"fal request timed out after {FAL_POLL_TIMEOUT_SEC}s", retryable=True
            )
        await asyncio.sleep(FAL_POLL_INTERVAL_SEC)
    final = await client.get(response_url)
    final.raise_for_status()
    return final.json()


async def _generate_fal(request: RenderRequest, *, spend: SpendContext | None) -> None:
    """fal's queue API, same submit/poll/download shape as `fal_video`.

    Priced from the pinned table rather than a response field: fal does
    not return a charge, and an unpriced render is an unmetered one.
    """
    if not settings.fal_api_key:
        raise RenderFailure(
            f"image model {request.model.id} needs MARKETER_FAL_API_KEY", retryable=False
        )
    cost = image_price(request.model)
    if spend is not None:
        await spend.ensure_can_spend(cost)

    body: dict = {
        "prompt": request.prompt,
        "image_size": "square_hd",
        "num_images": 1,
        "output_format": "png",
    }
    if request.logo_path is not None and request.model.image_input_field:
        uri = _data_uri(request.logo_path)
        body[request.model.image_input_field] = (
            [uri] if request.model.image_input_field.endswith("s") else uri
        )

    async with httpx.AsyncClient(
        timeout=HTTP_TIMEOUT_SEC,
        headers={"Authorization": f"Key {settings.fal_api_key}"},
    ) as client:
        submit = await client.post(f"{FAL_QUEUE_BASE}/{request.model.api_model}", json=body)
        submit.raise_for_status()
        result = await _fal_await_result(client, submit.json())

        # The provider charged us the moment the render completed —
        # record before downloading so a network blip on the CDN fetch
        # can't leave a paid image unbilled.
        if spend is not None:
            await spend.log(
                provider=PROVIDER_FAL,
                sku=request.model.id,
                units=Decimal(1),
                cost_usd=cost,
            )

        images = result.get("images") or []
        url = images[0].get("url") if images and isinstance(images[0], dict) else None
        if not url:
            raise RenderFailure(f"fal returned no image: {result!r}")
        request.out_path.parent.mkdir(parents=True, exist_ok=True)
        download = await client.get(url)
        download.raise_for_status()
        request.out_path.write_bytes(download.content)


_ADAPTERS = {
    "openai": _generate_openai,
    PROVIDER_FAL: _generate_fal,
}


# ── the render loop ───────────────────────────────────────────────────────


async def render_concept(
    brief: Brief,
    concept: PlannedConcept,
    out_path: Path,
    *,
    spend: SpendContext | None = None,
    sleep=asyncio.sleep,
) -> Path:
    """Render one Ad Slot. Raises `RenderFailure` if it never lands."""
    model = image_model_by_id(concept.model)
    if model is None:
        raise RenderFailure(f"unknown Image Model {concept.model!r}")
    adapter = _ADAPTERS.get(model.provider)
    if adapter is None:
        raise RenderFailure(f"no adapter for provider {model.provider!r}")

    base_prompt = build_concept_prompt(
        concept.key,
        PromptInput.from_brief(
            brief,
            subject=concept.subject,
            headline=concept.headline,
            subheadline=concept.subheadline,
        ),
    )

    logo_path: Path | None = None
    if model.raster_logo and brief.logo_url:
        logo_path = await load_logo(
            brief.logo_url, out_path.parent / f"{out_path.stem}.logo"
        )

    prompt = (
        f"{base_prompt}\n\n{logo_instruction(brief.brand_name)}"
        if logo_path is not None
        else base_prompt
    )
    logo_downgraded = False
    transient_failures = 0

    while True:
        request = RenderRequest(
            model=model, prompt=prompt, logo_path=logo_path, out_path=out_path
        )
        try:
            await adapter(request, spend=spend)
            return out_path
        except RenderFailure:
            raise
        except Exception as exc:  # noqa: BLE001 — classified, then re-raised
            from ..repos.spend import SpendCapExceeded

            if isinstance(exc, SpendCapExceeded):
                raise
            kind = classify_failure(exc, had_logo=logo_path is not None)

            if kind == "image_input_rejected" and not logo_downgraded:
                # The model advertised raster-logo support and then
                # refused this particular mark. Losing the logo is much
                # cheaper than losing the ad.
                log.info(
                    "ad creative logo rejected by model; retrying without it",
                    extra={"model": model.id, "error": str(exc)},
                )
                logo_path = None
                prompt = base_prompt
                logo_downgraded = True
                continue

            if kind != "transient":
                raise RenderFailure(str(exc), retryable=False) from exc
            if transient_failures >= len(TRANSIENT_DELAYS):
                raise RenderFailure(str(exc), retryable=True) from exc
            delay = TRANSIENT_DELAYS[transient_failures]
            transient_failures += 1
            await sleep(delay)


# ── run-level orchestration ───────────────────────────────────────────────


def _subject_fields(subject: ConceptSubject) -> dict:
    return {
        "subject_kind": subject.kind,
        "product_name": subject.name,
        "product_description": subject.description,
    }


async def _render_one_slot(
    slot: dict, brief: Brief, *, user_id: str, spend: SpendContext | None
) -> None:
    """Render one persisted Ad Slot, recording its outcome either way.

    A failed slot never fails the Ad Run: a Gallery with five of six
    images and one retry button is a far better outcome than nothing.
    """
    slot_id = slot["id"]
    run_id = slot["run_id"]
    concept = PlannedConcept(
        key=slot["direction_key"],
        model=slot["image_model_id"],
        subject=ConceptSubject(
            kind=slot["subject_kind"],
            name=slot.get("product_name") or "",
            description=slot.get("product_description") or "",
        ),
        headline=slot["headline"],
        subheadline=slot.get("subheadline") or "",
    )
    await runs_repo.set_slot_status(slot_id, user_id=user_id, status="rendering")
    out_path = slot_image_path(run_id, slot_id)
    try:
        await render_concept(brief, concept, out_path, spend=spend)
    except Exception as exc:  # noqa: BLE001 — one slot's failure is its own
        log.warning(
            "ad creative slot failed",
            extra={"run_id": str(run_id), "slot_id": str(slot_id), "error": str(exc)},
        )
        await runs_repo.fail_slot(slot_id, user_id=user_id, error=str(exc)[:500])
        return
    await runs_repo.complete_slot(slot_id, user_id=user_id, image_path=str(out_path))


async def render_slots(
    slots: list[dict], brief: Brief, *, user_id: str, spend: SpendContext | None
) -> None:
    """Fan out over Ad Slots, bounded by `ad_creative_fanout_limit`.

    The bound is a spend-rate control as much as a rate-limit one: six
    unbounded renders can cross a daily cap between the pre-flight check
    and the first ledger write.
    """
    gate = asyncio.Semaphore(fanout_limit())

    async def run(slot: dict) -> None:
        async with gate:
            await _render_one_slot(slot, brief, user_id=user_id, spend=spend)

    await asyncio.gather(*(run(slot) for slot in slots), return_exceptions=True)


async def execute_run(user_id: str, run_id: UUID) -> dict:
    """Plan and render one Ad Run end to end. The background entry point.

    Planning failures fail the whole run (there is nothing to show);
    render failures fail only their own Ad Slot.
    """
    from .planner import AdRunPlanningError, plan_ad_run

    run = await runs_repo.get_run(run_id, user_id=user_id)
    if run is None:
        raise RuntimeError(f"ad creative run {run_id} not found for {user_id}")

    spend = await _spend_for_run(run)
    await runs_repo.set_run_status(run_id, user_id=user_id, status="planning")
    try:
        plan: AdRunPlan = await plan_ad_run(run["domain"], spend=spend)
    except AdRunPlanningError as exc:
        await runs_repo.fail_run(run_id, user_id=user_id, error=f"{exc.code}: {exc}")
        return {"status": "failed", "error": exc.code}
    except Exception as exc:  # noqa: BLE001 — the run row must always settle
        await runs_repo.fail_run(run_id, user_id=user_id, error=str(exc)[:500])
        return {"status": "failed", "error": "internal"}

    await runs_repo.save_plan(
        run_id,
        user_id=user_id,
        brand_name=plan.brief.brand_name,
        brief=plan.brief.model_dump(mode="json"),
        concepts=[
            {
                "position": index,
                "direction_key": concept.key,
                "image_model_id": concept.model,
                "headline": concept.headline,
                "subheadline": concept.subheadline,
                **_subject_fields(concept.subject),
            }
            for index, concept in enumerate(plan.concepts)
        ],
    )
    await runs_repo.set_run_status(run_id, user_id=user_id, status="rendering")

    slots = await runs_repo.list_slots(run_id, user_id=user_id)
    await render_slots(slots, plan.brief, user_id=user_id, spend=spend)
    return await runs_repo.settle_run(run_id, user_id=user_id)


async def retry_slot(user_id: str, run_id: UUID, slot_id: UUID) -> dict:
    """Re-render one already-claimed Ad Slot against its stored plan."""
    run = await runs_repo.get_run(run_id, user_id=user_id)
    slot = await runs_repo.get_slot(slot_id, user_id=user_id)
    if run is None or slot is None:
        raise RuntimeError(f"ad creative slot {slot_id} not found for {user_id}")
    brief = Brief.model_validate(run["brief"])
    spend = await _spend_for_run(run)
    await _render_one_slot(slot, brief, user_id=user_id, spend=spend)
    return await runs_repo.settle_run(run_id, user_id=user_id)


async def _spend_for_run(run: dict) -> SpendContext:
    """One SpendContext per run, carrying the niche's daily cap when the
    run was filed under a niche."""
    from ..repos import niches as niches_repo
    from ..services.spend_context import default_context

    niche_id = run.get("niche_id")
    cap = None
    if niche_id is not None:
        niche = await niches_repo.get(niche_id, user_id=run["user_id"])
        cap = getattr(niche, "daily_spend_cap_usd", None) if niche else None
    return await default_context(
        user_id=run["user_id"], niche_id=niche_id, job_id=None, cap_usd=cap
    )
