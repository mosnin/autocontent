"""One tenant-scoped, uncapped inventory over the existing production records.

The cursor is a position, never an authority: every branch always scopes by the
authenticated user. Inserts after asOf are excluded; deletes simply disappear.
Titles/status remain live. No remote media URLs or provider secrets are exposed.
"""

from __future__ import annotations

import base64
import hashlib
import json
from datetime import datetime, timezone
from uuid import UUID

from ..db import get_pool
from ..config import settings

# kind: (table, title keys, native route, content fields)
FAMILIES = {
    "campaign": ("campaigns", ("name",), "/campaigns/{id}", ("name", "objective", "budget_usd")),
    "paid-campaign": (
        "ad_campaigns",
        ("name",),
        "/ads/campaigns/{id}",
        ("name", "objective", "daily_budget_usd"),
    ),
    "video": ("jobs", ("title",), "/queue/{id}", ("payload",)),
    "article": (
        "articles",
        ("title", "topic"),
        "/articles/{id}",
        ("title", "article_markdown", "hero_image_path", "meta_description"),
    ),
    "image-post": ("image_posts", ("topic",), "/campaigns/{campaign_id}", ("topic", "payload")),
    "ad": (
        "ad_creatives",
        ("headline",),
        "/ads/campaigns/{campaign_id}",
        ("headline", "body", "media_path", "cta"),
    ),
    "ad-slot": (
        "ad_creative_slots",
        ("headline", "product_name"),
        "/ad-creatives/{run_id}",
        ("headline", "subheadline", "image_path", "product_description"),
    ),
    "ugc": ("ugc_renders", ("prompt",), "/ugc", ("prompt", "video_url", "aspect_ratio")),
    "drama": ("micro_dramas", ("idea",), "/dramas/{id}", ("idea", "script", "plan", "video_path")),
    "design": ("design_projects", ("brief",), "/ads/design/{id}", ("brief", "plan", "canvas")),
    "motion": (
        "motion_projects",
        ("narration",),
        "/motion/{id}",
        ("narration", "beats", "overlays", "video_path", "style_key"),
    ),
    "headshot": ("headshot_variants", (), "/ads/headshots/{batch_id}", ("image_path",)),
    "composition": (
        "compositions",
        ("title",),
        "/library",
        ("title", "clip_asset_ids", "audio_mode", "output_asset_id"),
    ),
    "asset": (
        "media_assets",
        ("title", "kind"),
        "/library",
        ("object_key", "kind", "content_type", "size_bytes", "title", "duration_sec", "revision"),
    ),
}
CAMPAIGNS = {"campaign", "paid-campaign"}


def fingerprint(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, default=str, separators=(",", ":")).encode()
    ).hexdigest()


def cursor_encode(value: dict) -> str:
    return (
        base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode())
        .decode()
        .rstrip("=")
    )


def cursor_decode(value: str, binding: str) -> dict:
    try:
        if len(value) > 2048:
            raise ValueError()
        data = json.loads(base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)))
        if not isinstance(data, dict) or any(
            not isinstance(data.get(k), str) for k in ("binding", "kind", "id", "asOf", "created")
        ):
            raise ValueError()
        if data["binding"] != binding or data["kind"] not in FAMILIES:
            raise ValueError()
        for key in ("asOf", "created"):
            parsed = datetime.fromisoformat(data[key])
            if parsed.tzinfo is None or parsed > datetime.now(timezone.utc):
                raise ValueError()
        UUID(data["id"])
        return data
    except (ValueError, TypeError, KeyError, UnicodeError):
        raise ValueError("This page cursor is invalid. Refresh the library.") from None


def normalize(kind: str, row: dict) -> dict:
    _, title_keys, route, _ = FAMILIES[kind]
    title = next((str(row[k]) for k in title_keys if row.get(k)), kind.replace("-", " ").title())
    if kind == "video":
        title = (
            row.get("video_title")
            or ((row.get("payload") or {}).get("script") or {}).get("idea", {}).get("topic")
            or title
        )
    campaign = row.get("campaign_id")
    campaign_kind = "paid-campaign" if kind == "ad" else "campaign"
    native = route
    for key in ("id", "campaign_id", "run_id", "batch_id"):
        native = native.replace("{" + key + "}", str(row.get(key) or ""))
    if kind == "ad" and row.get("source_job_id"):
        native = f"/queue/{row['source_job_id']}"
    elif kind == "ad" and row.get("source_article_id"):
        native = f"/articles/{row['source_article_id']}"
    elif kind == "image-post" or (kind == "ad" and not campaign):
        native = f"/production/{kind}/{row['id']}"
    return {
        "id": f"{kind}:{row['id']}",
        "kind": kind,
        "title": title[:240],
        "status": str(row.get("status") or "available"),
        "updatedAt": str(row.get("updated_at") or row["created_at"]),
        "sourceUrl": (settings.app_url or "https://www.marketer.sh").rstrip("/") + native,
        "productionUrl": (settings.app_url or "https://www.marketer.sh").rstrip("/")
        + f"/production/{kind}/{row['id']}",
        "campaignIds": [f"{campaign_kind}:{campaign}"] if campaign else [],
        "groupId": str(row.get("run_id") or row.get("batch_id") or ""),
    }


async def list_items(
    user_id: str,
    collection: str,
    *,
    limit: int = 25,
    cursor: str | None = None,
    kind: str | None = None,
    campaign_id: str | None = None,
    search: str = "",
) -> dict:
    kinds = sorted(CAMPAIGNS if collection == "campaigns" else set(FAMILIES) - CAMPAIGNS)
    if kind:
        if kind not in kinds:
            raise ValueError("Unknown format for this collection")
        kinds = [kind]
    campaign_kind, campaign_uuid = None, None
    if campaign_id and campaign_id != "unassigned":
        try:
            campaign_kind, raw_id = campaign_id.split(":", 1)
            campaign_uuid = str(UUID(raw_id))
            if campaign_kind not in CAMPAIGNS:
                raise ValueError()
        except ValueError:
            raise ValueError("Invalid campaign") from None
    binding = fingerprint([user_id, collection, kind, campaign_id, search])
    page = cursor_decode(cursor, binding) if cursor else None
    as_of = datetime.fromisoformat(page["asOf"]) if page else datetime.now(timezone.utc)
    branches = []
    # Identifiers come exclusively from the static map. User values are parameters.
    for family in kinds:
        table, title_keys, _, _ = FAMILIES[family]
        keys = set(title_keys) | {
            "status",
            "campaign_id",
            "run_id",
            "batch_id",
            "updated_at",
            "source_job_id",
            "source_article_id",
        }
        pairs = ", ".join(f"'{key}', to_jsonb(t)->'{key}'" for key in sorted(keys))
        video = ", 'video_title', t.payload #>> '{script,idea,topic}'" if family == "video" else ""
        branches.append(
            f"SELECT '{family}' AS kind, t.id, t.created_at, jsonb_build_object('id', t.id, 'created_at', t.created_at, {pairs}{video}) AS data FROM {table} t WHERE t.user_id=$1 AND t.created_at <= $2"
        )
    query = " UNION ALL ".join(branches)
    rows = await (await get_pool()).fetch(
        f"""WITH inventory AS ({query}) SELECT * FROM inventory
        WHERE ($3::timestamptz IS NULL OR (created_at, kind, id) < ($3, $4, $5::uuid))
          AND ($6::text IS NULL OR ($6 = 'unassigned' AND data->>'campaign_id' IS NULL)
            OR (data->>'campaign_id' = $7 AND (($8 = 'paid-campaign' AND kind = 'ad')
              OR ($8 = 'campaign' AND kind IN ('video','article','image-post'))))
            OR ($8 = 'campaign' AND kind = 'ad' AND EXISTS (
              SELECT 1 FROM campaign_items ci JOIN campaigns c ON c.id=ci.campaign_id
              JOIN ad_campaigns ac ON ac.id=ci.ref_id
              WHERE ci.kind='ad' AND ci.user_id=$1 AND c.user_id=$1 AND ac.user_id=$1
                AND c.id::text=$7 AND ac.id::text=data->>'campaign_id')))
          AND ($9 = '' OR strpos(lower(data::text), lower($9)) > 0)
        ORDER BY created_at DESC, kind DESC, id DESC LIMIT $10""",
        user_id,
        as_of,
        datetime.fromisoformat(page["created"]) if page else None,
        page["kind"] if page else "",
        UUID(page["id"]) if page else None,
        campaign_id,
        campaign_uuid,
        campaign_kind,
        search,
        limit + 1,
    )
    selected = rows[:limit]
    next_cursor = None
    if len(rows) > limit:
        last = selected[-1]
        next_cursor = cursor_encode(
            {
                "binding": binding,
                "asOf": as_of.isoformat(),
                "created": last["created_at"].isoformat(),
                "kind": last["kind"],
                "id": str(last["id"]),
            }
        )
    return {
        "items": [
            normalize(r["kind"], json.loads(r["data"]) if isinstance(r["data"], str) else r["data"])
            for r in selected
        ],
        "nextCursor": next_cursor,
        "asOf": as_of.isoformat(),
    }


async def source(
    user_id: str, kind: str, record_id: UUID, *, connection=None, lock=False
) -> dict | None:
    if kind not in FAMILIES:
        return None
    conn = connection or await get_pool()
    table = FAMILIES[kind][0]
    row = await conn.fetchrow(
        f"SELECT to_jsonb(t) AS data FROM {table} t WHERE id=$1 AND user_id=$2"
        + (" FOR SHARE" if lock else ""),
        record_id,
        user_id,
    )
    if not row:
        return None
    data = json.loads(row["data"]) if isinstance(row["data"], str) else row["data"]
    content = {key: data.get(key) for key in FAMILIES[kind][3]}
    if kind == "video":
        payload = data.get("payload") or {}
        content = {
            key: payload.get(key)
            for key in ("script", "clips", "rendered", "rendered_video", "voiceover_path", "audio")
        }
    # Conservative revision invalidation also catches re-renders to the same path.
    content["source_revision"] = data.get("updated_at") or data.get("created_at")
    payload = data.get("payload") or {}
    output = {
        "video": bool(payload.get("rendered") or payload.get("rendered_video")),
        "article": bool(str(data.get("article_markdown") or "").strip()),
        "image-post": bool(payload.get("images") or payload.get("slides")),
        "ad": bool(
            str(data.get("headline") or data.get("body") or "").strip()
            and (data.get("kind") == "text" or data.get("media_path"))
        ),
        "ad-slot": bool(data.get("image_path")),
        "ugc": bool(data.get("video_url")),
        "drama": bool(data.get("video_path")),
        "design": bool(data.get("canvas")),
        "motion": bool(data.get("video_path")),
        "headshot": bool(data.get("image_path")),
        "composition": bool(data.get("output_asset_id")),
        "asset": bool(data.get("object_key")),
        "campaign": False,
        "paid-campaign": False,
    }.get(kind, False)
    # Review anchors are scoped to this entire content revision, never silently
    # reassigned by scene index after a rewrite.
    anchors = [{"id": "whole", "label": "Whole creative"}]
    script = content.get("script") or {}
    if isinstance(script, dict):
        anchors += [
            {
                "id": f"scene:{i}",
                "label": f"Scene {i + 1}",
                "text": str(s.get("narration", ""))[:1200],
            }
            for i, s in enumerate(script.get("scenes", [])[:100])
            if isinstance(s, dict)
        ]
    return {
        "item": normalize(kind, data),
        "fingerprint": fingerprint(content),
        "anchors": anchors,
        "data": data,
        "has_output": output,
        "excerpt": str(
            payload.get("caption")
            or "\n\n".join(str(v) for v in (data.get("body"), data.get("cta")) if v)
            or ""
        )[:10000],
        "preview_count": min(len(payload.get("slides") or []), 20)
        if kind == "image-post"
        else (0 if kind == "ad" and data.get("kind") == "text" else 1),
    }
