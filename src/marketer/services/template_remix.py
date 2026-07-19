"""Template remix worker: the user's product, the template's aesthetic.

Feeds gpt-image-1 edit BOTH references — the admin's template look and
the user's product shot — with the template's own prompt, so the output
keeps the template aesthetic with the user's product in it. Results land
in the media library ('keyframe' assets titled "Remix: <template>").

Spend is metered (niche-less: global caps + billing apply; per-niche
caps don't, since remixes belong to no niche).
"""
from __future__ import annotations

from pathlib import Path
from uuid import UUID, uuid4

from ..config import settings
from ..logging import get_logger
from ..repos import media as media_repo
from ..repos import templates as templates_repo
from ..services import object_storage, openai_images
from ..services.spend_context import default_context

log = get_logger(__name__)

MAX_REMIX_COUNT = 4


async def run_remix(
    *,
    user_id: str,
    template_id: UUID,
    product_path: str = "",
    count: int = 2,
    note: str = "",
) -> dict:
    template = await templates_repo.get(template_id)
    if template is None or not template.is_published:
        return {"status": "failed", "error": "template not found"}

    references: list[Path] = []
    ref = Path(template.reference_key) if template.reference_key else None
    if ref is not None and ref.exists():
        references.append(ref)
    product = Path(product_path) if product_path else None
    if product is not None and product.exists():
        references.append(product)
    if not references:
        return {"status": "failed", "error": "no reference images available"}

    prompt = template.prompt
    if product is not None:
        prompt += (
            "\nReplace the featured product/subject with the product from "
            "the LAST reference image, keeping the aesthetic, lighting, "
            "composition, and typography treatment identical."
        )
    if note:
        prompt += f"\nCreator note: {note}"

    spend = await default_context(
        user_id=user_id, niche_id=None, job_id=None, cap_usd=None,
    )

    out_dir = Path(settings.artifacts_dir) / user_id / "remixes" / str(template_id)
    generated = 0
    for i in range(max(1, min(MAX_REMIX_COUNT, count))):
        out = out_dir / f"remix_{uuid4().hex[:8]}.png"
        try:
            await openai_images.generate_remix(
                prompt, out, reference_paths=references, spend=spend,
            )
        except Exception as e:  # noqa: BLE001 — record what succeeded so far
            log.warning("remix generation failed", extra={"error": str(e)})
            break
        if object_storage.enabled():
            storage = "wasabi"
            key = f"users/{user_id}/remixes/{template_id}/{out.name}"
            await object_storage.upload_file(out, key)
        else:
            storage, key = "volume", str(out)
        await media_repo.record_asset(
            user_id=user_id,
            kind="keyframe",
            storage=storage,
            object_key=key,
            content_type="image/png",
            size_bytes=out.stat().st_size,
            title=f"Remix: {template.name} #{generated + 1}",
        )
        generated += 1

    return {
        "status": "done" if generated else "failed",
        "generated": generated,
        "template": template.name,
    }
