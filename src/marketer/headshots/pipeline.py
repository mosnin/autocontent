"""Headshot batch orchestration: one batch -> N metered portraits.

Layering note (see the package docstring): `styles.py` and `prompts.py`
are pure, this module is the only part of the lane that touches storage,
money, and the provider. It mirrors `adcreative/renderer.py` — bounded
fan-out, per-item status, one SpendContext for the whole unit of work,
terminal state settled from what actually landed.

WHY A VARIANT'S FAILURE DOES NOT FAIL THE BATCH
-----------------------------------------------
A batch is N independent charges, not one. Four portraits with one broken
frame and a retry button is a much better outcome than throwing away
three paid-for images, so each variant records its own outcome and the
batch settles to `done` / `partial` / `failed` from the tally.

WHY THE SPEND CAP IS CHECKED TWICE
----------------------------------
Once up front for the whole batch (`_gate_batch`), so a user who cannot
afford twelve portraits is told before we render one; and again inside
every variant, because `openai_images.generate_keyframe` runs
`ensure_can_spend` immediately before its call and `SpendContext.log`
re-reads the ledger immediately after. The second check is the one that
actually holds: N concurrent variants all clear the same pre-flight
snapshot, and only the post-write re-read can see the cap being crossed.
When it trips, `abort_event` is already set, so every variant still
waiting on the semaphore refuses instantly and is recorded `cancelled` —
"we deliberately did not spend this" — instead of `failed`.
"""
from __future__ import annotations

import asyncio
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

from ..config import settings
from ..logging import get_logger
from ..repos import headshots as repo
from ..services.openai_pricing import image_cost
from ..services.spend_context import SpendContext
from ..storage import volume
from .prompts import build_variant_prompt
from .styles import HeadshotStyle, UnknownStyleError, get_style

log = get_logger(__name__)

# gpt-image-1's portrait tier. A headshot that has to be cropped from a
# square is a headshot the photographer didn't frame.
PORTRAIT_SIZE = "1024x1536"

# `high` costs 4x `medium` and is still the right call here: this image is
# published full-size next to a real person's name, and medium's softer
# rendering of eyes, hair edges, and skin texture is exactly the failure a
# viewer reads as "AI photo". Quality is the product.
PORTRAIT_QUALITY = "high"

# Upload policy. Photographs of a person come from phone cameras, so JPEG
# first; the ceiling is generous enough for a modern phone shot and small
# enough that a batch's references can't exhaust a container's memory.
ALLOWED_SOURCE_TYPES: tuple[str, ...] = ("image/jpeg", "image/png", "image/webp")
MAX_SOURCE_BYTES = 12 * 1024 * 1024
# Beyond a handful of angles the model gains nothing and every extra
# reference is bytes on every one of the N provider calls.
MAX_SOURCE_IMAGES = 6

# Leading bytes per accepted format. The declared content type is client
# input; a file that isn't actually an image is either an attack or a
# guaranteed provider rejection we'd otherwise discover after charging.
_MAGIC: tuple[tuple[bytes, str], ...] = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"RIFF", "image/webp"),
)

_EXTENSIONS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


class SourceRejected(ValueError):
    """An uploaded photo that must not be stored (type, size, or content)."""


def is_configured() -> bool:
    """False when the deployment has no image key, so the HTTP surface can
    answer 409 instead of accepting a batch it can never render."""
    return bool(settings.openai_api_key)


# ── volume layout ─────────────────────────────────────────────────────────
#
# Everything lives under the user's own partition: these are photographs of
# an identifiable person, so a path must never be derivable from another
# user's ids alone, and erasure must be a subtree walk.


def user_root(user_id: str) -> Path:
    return volume.job_root(user_id) / "headshots"


def sources_root(user_id: str) -> Path:
    return user_root(user_id) / "sources"


def batch_root(user_id: str, batch_id: UUID | str) -> Path:
    return user_root(user_id) / str(batch_id)


def variant_image_path(user_id: str, batch_id: UUID | str, variant_id: UUID | str) -> Path:
    return batch_root(user_id, batch_id) / f"{variant_id}.png"


def sniff_image_type(data: bytes) -> str | None:
    """The format the bytes actually are, or None."""
    for prefix, content_type in _MAGIC:
        if data.startswith(prefix):
            # RIFF containers are not all WebP (AVI is RIFF too).
            if content_type == "image/webp" and data[8:12] != b"WEBP":
                continue
            return content_type
    return None


def store_source(user_id: str, data: bytes, *, declared_type: str) -> tuple[Path, str]:
    """Validate an uploaded photograph and write it to the user's partition.

    Returns (path, resolved content type). Raises `SourceRejected` with a
    user-facing message for anything we won't store. The filename is a
    fresh uuid: the client's filename is metadata for the picker only, and
    using it to build a path would be a traversal primitive.
    """
    if not data:
        raise SourceRejected("the uploaded file is empty")
    if len(data) > MAX_SOURCE_BYTES:
        mb = MAX_SOURCE_BYTES // (1024 * 1024)
        raise SourceRejected(f"photo is larger than the {mb}MB limit")
    if declared_type not in ALLOWED_SOURCE_TYPES:
        raise SourceRejected(
            f"unsupported file type {declared_type!r}; "
            f"upload one of {', '.join(ALLOWED_SOURCE_TYPES)}"
        )
    actual = sniff_image_type(data)
    if actual is None or actual != declared_type:
        raise SourceRejected("file contents are not a JPEG, PNG, or WebP image")

    path = sources_root(user_id) / f"{uuid4()}{_EXTENSIONS[actual]}"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path, actual


# ── money ─────────────────────────────────────────────────────────────────


def variant_cost() -> Decimal:
    return image_cost(PORTRAIT_QUALITY, size=PORTRAIT_SIZE)


async def _spend_for_batch(batch: dict) -> SpendContext:
    """One SpendContext per batch, carrying the niche's daily cap when the
    batch was filed under a niche. An unattributed batch (the common case —
    a founder portrait belongs to the account, not a channel) is still
    subject to the user's global cap and prepaid credit."""
    from ..repos import niches as niches_repo
    from ..services.spend_context import default_context

    niche_id = batch.get("niche_id")
    cap = None
    if niche_id is not None:
        niche = await niches_repo.get(niche_id, user_id=batch["user_id"])
        cap = getattr(niche, "daily_spend_cap_usd", None) if niche else None
    return await default_context(
        user_id=batch["user_id"], niche_id=niche_id, job_id=None, cap_usd=cap
    )


# ── one variant ───────────────────────────────────────────────────────────


async def _generate(
    prompt: str, out_path: Path, *, references: list[Path], spend: SpendContext
) -> None:
    """Render one portrait through the product's existing image path.

    Both primitives meter themselves (`ensure_can_spend` before the call,
    `log` after it returns), which is why this function never touches the
    ledger itself — a second charge here would double-bill.
    """
    from ..services import openai_images

    out_path.parent.mkdir(parents=True, exist_ok=True)
    if len(references) == 1:
        await openai_images.generate_keyframe(
            prompt,
            out_path,
            quality=PORTRAIT_QUALITY,
            size=PORTRAIT_SIZE,
            reference_image_path=references[0],
            spend=spend,
        )
        return
    # Several angles of the same face give the model far more to preserve
    # than one frontal shot, so multi-reference is the normal path.
    await openai_images.generate_remix(
        prompt,
        out_path,
        reference_paths=references,
        quality=PORTRAIT_QUALITY,
        size=PORTRAIT_SIZE,
        spend=spend,
    )


async def _render_variant(
    variant: dict,
    *,
    batch: dict,
    style: HeadshotStyle,
    references: list[Path],
    spend: SpendContext,
) -> None:
    """Render one variant, recording its outcome either way."""
    from ..repos.spend import SpendCapExceeded

    variant_id = variant["id"]
    await repo.set_variant_status(variant_id, status="running")
    prompt = build_variant_prompt(
        style,
        variant_index=int(variant["variant_index"]),
        subject_notes=batch.get("subject_notes") or "",
        has_reference=bool(references),
    )
    out_path = variant_image_path(batch["user_id"], batch["id"], variant_id)
    try:
        await _generate(prompt, out_path, references=references, spend=spend)
    except SpendCapExceeded as exc:
        # `after_spend` is the difference between a charge that landed and
        # one that never happened, and the retry button bills accordingly:
        # cancelled variants are re-rendered for free, failed ones were
        # already paid for once.
        status = "failed" if exc.after_spend else "cancelled"
        await repo.set_variant_status(variant_id, status=status, error=str(exc)[:500])
        return
    except Exception as exc:  # noqa: BLE001 — one variant's failure is its own
        log.warning(
            "headshot variant failed",
            extra={
                "batch_id": str(batch["id"]),
                "variant_id": str(variant_id),
                "error": str(exc),
            },
        )
        await repo.set_variant_status(variant_id, status="failed", error=str(exc)[:500])
        return
    await repo.set_variant_status(variant_id, status="done", image_path=str(out_path))


async def _render_variants(
    variants: list[dict],
    *,
    batch: dict,
    style: HeadshotStyle,
    references: list[Path],
    spend: SpendContext,
) -> None:
    """Fan out over the batch's queued variants, bounded by
    `scene_fanout_limit`.

    The bound is a spend-rate control as much as a rate-limit one: twelve
    unbounded portrait calls can cross a daily cap between the pre-flight
    check and the first ledger write.
    """
    gate = asyncio.Semaphore(max(1, int(settings.scene_fanout_limit)))

    async def run(variant: dict) -> None:
        async with gate:
            await _render_variant(
                variant, batch=batch, style=style, references=references, spend=spend
            )

    await asyncio.gather(*(run(v) for v in variants), return_exceptions=True)


# ── batch orchestration ───────────────────────────────────────────────────


async def _fail(batch_id: UUID, *, user_id: str, error: str) -> dict:
    await repo.set_batch_status(batch_id, user_id=user_id, status="failed", error=error)
    return {"status": "failed", "error": error}


async def _cancel_all(variants: list[dict], *, error: str) -> None:
    for variant in variants:
        await repo.set_variant_status(variant["id"], status="cancelled", error=error[:500])


async def _reference_paths(batch: dict) -> list[Path]:
    """The batch's source photographs, in the order the user picked them
    (first = primary face reference), skipping any whose bytes are gone."""
    ids = [UUID(str(s)) for s in (batch.get("source_image_ids") or [])]
    rows = await repo.get_sources(ids, user_id=batch["user_id"])
    return [Path(r["path"]) for r in rows if Path(r["path"]).exists()]


async def _gate_batch(
    variants: list[dict], *, spend: SpendContext
) -> str | None:
    """Refuse the whole batch up front when it cannot be afforded.

    Returns the refusal message, or None to proceed. Estimating the full
    fan-out (rather than one variant) is deliberate: telling someone their
    twelve-portrait batch stopped at variant three is a worse experience
    than telling them before anything renders.
    """
    from ..repos.spend import SpendCapExceeded

    try:
        await spend.ensure_can_spend(variant_cost() * len(variants))
    except SpendCapExceeded as exc:
        return str(exc)
    return None


def _settle(variants: list[dict]) -> tuple[str, str | None]:
    """Terminal batch status from what actually landed, plus a summary."""
    done = [v for v in variants if v["status"] == "done"]
    if len(done) == len(variants):
        return "done", None
    unfinished = [v for v in variants if v["status"] != "done"]
    reason = next((v["error"] for v in unfinished if v.get("error")), "") or "no image"
    summary = f"{len(done)}/{len(variants)} portraits rendered: {reason}"[:500]
    return ("partial" if done else "failed"), summary


async def _archive(batch: dict, variants: list[dict]) -> int:
    """Index finished portraits in the media library so the video, article,
    and UGC lanes can reuse them as founder/team imagery.

    Fail-open, exactly like `media_archive.archive_job_media`: the
    portraits exist and were paid for, and a storage hiccup must never
    turn a delivered batch into a failed one.
    """
    from ..repos import media as media_repo
    from ..services import object_storage

    style_label = batch.get("style_key", "")
    archived = 0
    try:
        for variant in variants:
            path = Path(variant["image_path"]) if variant.get("image_path") else None
            if path is None or not path.exists():
                continue
            if object_storage.enabled():
                storage = "wasabi"
                key = (
                    f"users/{batch['user_id']}/headshots/"
                    f"{batch['id']}/{variant['id']}.png"
                )
                await object_storage.upload_file(path, key)
            else:
                storage, key = "volume", str(path)
            await media_repo.record_asset(
                user_id=batch["user_id"],
                niche_id=batch.get("niche_id"),
                kind="keyframe",
                scene_index=int(variant["variant_index"]),
                storage=storage,
                object_key=key,
                content_type="image/png",
                size_bytes=path.stat().st_size,
                title=f"{style_label} headshot {int(variant['variant_index']) + 1}",
            )
            archived += 1
    except Exception as exc:  # noqa: BLE001 — never breaks a delivered batch
        log.warning(
            "headshot archive failed",
            extra={"batch_id": str(batch["id"]), "error": str(exc)},
        )
    return archived


async def run_headshot_batch(*, user_id: str, batch_id: UUID) -> dict:
    """Drive one headshot batch to a terminal state. The background entry
    point — `modal_app.run_headshot_batch` is a thin wrapper over this.

    Safe to spawn twice: the queued -> running claim is atomic, so the
    loser returns without spending.
    """
    batch = await repo.get_batch(batch_id, user_id=user_id)
    if batch is None:
        raise RuntimeError(f"headshot batch {batch_id} not found for {user_id}")

    claimed = await repo.claim_for_run(batch_id, user_id=user_id)
    if claimed is None:
        # Another spawn already owns this batch (or a human deleted it
        # mid-flight). Doing nothing is the whole point of the claim.
        return {"status": batch["status"], "skipped": "not queued"}
    batch = claimed

    try:
        style = get_style(batch["style_key"])
    except UnknownStyleError as exc:
        return await _fail(batch_id, user_id=user_id, error=str(exc)[:500])

    references = await _reference_paths(batch)
    if not references:
        # `build_variant_prompt` can render without a reference, but a
        # headshot of nobody in particular is not what was paid for.
        return await _fail(
            batch_id,
            user_id=user_id,
            error="source photos are missing from storage; re-upload them and retry",
        )

    variants = await repo.list_variants(batch_id, user_id=user_id)
    pending = [v for v in variants if v["status"] in ("queued", "running")]
    if not pending:
        return await _fail(batch_id, user_id=user_id, error="batch has no queued variants")

    spend = await _spend_for_batch(batch)
    refusal = await _gate_batch(pending, spend=spend)
    if refusal is not None:
        await _cancel_all(pending, error=refusal)
        return await _fail(batch_id, user_id=user_id, error=refusal[:500])

    await _render_variants(
        pending, batch=batch, style=style, references=references, spend=spend
    )

    settled = await repo.list_variants(batch_id, user_id=user_id)
    await _archive(batch, [v for v in settled if v["status"] == "done"])
    status, summary = _settle(settled)
    await repo.set_batch_status(batch_id, user_id=user_id, status=status, error=summary)
    return {
        "status": status,
        "done": sum(1 for v in settled if v["status"] == "done"),
        "failed": sum(1 for v in settled if v["status"] == "failed"),
        "cancelled": sum(1 for v in settled if v["status"] == "cancelled"),
    }


# ── erasure ───────────────────────────────────────────────────────────────


def _unlink(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError as exc:  # noqa: PERF203 — one bad path must not stop the sweep
        log.warning("headshot file unlink failed", extra={"path": str(path), "error": str(exc)})


async def purge_user_files(user_id: str) -> int:
    """Unlink every source photograph and rendered portrait a user holds.

    Called BEFORE `privacy.erase_user`: the rows are what tell us which
    files exist, so deleting them first would strand the bytes — and these
    bytes are photographs of an identifiable person, which is precisely
    the data a right-to-erasure request is about. Returns how many files
    were removed. Never raises: erasure must complete even if the volume
    is unhappy.
    """
    removed = 0
    try:
        paths = await repo.list_source_paths(user_id)
        paths += await repo.list_image_paths(user_id)
    except Exception as exc:  # noqa: BLE001 — erasure proceeds regardless
        log.warning("headshot purge could not list files", extra={"error": str(exc)})
        return 0
    for raw in paths:
        path = Path(raw)
        if path.exists():
            _unlink(path)
            removed += 1
    # The per-batch directories are ours alone, so an empty-tree sweep is
    # safe and keeps the volume from filling with dead directories.
    root = user_root(user_id)
    if root.exists():
        for directory in sorted(root.rglob("*"), reverse=True):
            if directory.is_dir():
                try:
                    directory.rmdir()
                except OSError:
                    pass  # not empty: something else owns it, leave it alone
    return removed


def delete_files(paths: list[str]) -> None:
    """Unlink stored files whose rows are already gone. Best-effort: a
    missing or unlinkable file must not turn a successful delete into a
    500 for the caller."""
    for raw in paths:
        _unlink(Path(raw))


async def delete_batch_files(user_id: str, batch_id: UUID, paths: list[str]) -> None:
    """Remove a deleted batch's rendered images and its directory.

    Source photos are deliberately untouched: they are the user's own
    uploads and are shared across batches."""
    delete_files(paths)
    root = batch_root(user_id, batch_id)
    if root.exists():
        for leftover in root.iterdir():
            if leftover.is_file():
                _unlink(leftover)
        try:
            root.rmdir()
        except OSError:
            pass
