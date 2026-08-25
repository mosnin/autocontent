"""MCP tools for the media-generation surface: models, submit, status, asset.

Design constraints this module deliberately obeys:

* **One MCP server.** `marketer/mcp_server.py` already builds the
  `FastMCP("marketer")` instance and owns the stdio transport. This module
  only supplies tools; `register(mcp, client_factory)` binds them.
* **One auth path.** Every tool runs through the caller's
  `MarketerClient`, i.e. the personal access token in
  `MARKETER_API_TOKEN`, exactly like every existing tool. There is no
  second credential, no direct provider key read from the agent's
  environment, and therefore nothing an agent can call that isn't scoped
  to the user whose token started the server.
* **One metering path.** Anything that spends money goes through the HTTP
  API (`POST /api/v1/ugc/renders`), which runs `SpendContext` —
  per-niche daily cap, global daily cap, prepaid credit — before it
  submits. Calling a provider module directly from here would create a
  spend path with no caps, so we don't.
* **Validate before spending.** For Seedance models the capability table
  in `services/seedance.py` validates aspect ratio, duration, resolution
  and camera move locally, so a bad parameter fails instantly instead of
  costing a network round trip (and the API validates again server-side —
  this is a fast path, not the security boundary).

Tools are plain async functions taking the client factory as their first
argument, so tests drive them with an `httpx.MockTransport`-backed client
and no MCP client at all.
"""
from __future__ import annotations

import json
from typing import Any, Awaitable, Callable, Iterable

from ..sdk import MarketerClient, MarketerError
from ..services import seedance

# A zero-arg factory returning a fresh, token-scoped client used as an
# async context manager — the exact shape `mcp_server.build_server` already
# has in its local `_client()`.
ClientFactory = Callable[[], MarketerClient]

UGC_MODELS_PATH = "/api/v1/ugc/models"
UGC_RENDERS_PATH = "/api/v1/ugc/renders"
VIDEO_MODELS_PATH = "/api/v1/providers/video-models"

# Terminal-ish states of a render row, mirrored from the UGC repo's
# vocabulary so the asset tool can say "not ready yet" instead of handing
# back an empty URL that an agent would treat as a broken asset.
_SEEDANCE_PREFIX = "seedance-2.5"

_DONE_STATUSES = frozenset({"done", "completed", "succeeded"})
_FAILED_STATUSES = frozenset({"failed", "error", "canceled", "cancelled"})


def _dump(value: Any) -> str:
    return json.dumps(value, indent=2, default=str)


async def _get_json(client: MarketerClient, path: str, **kwargs: Any) -> Any:
    # MarketerClient exposes one typed method per surface and no generic
    # escape hatch; the media endpoints have no typed method yet and
    # sdk.py is not this feature's file to edit. Going through the
    # client's own request path keeps base URL, bearer token, timeout and
    # MarketerError translation identical to every other tool instead of
    # opening a second HTTP client with its own auth.
    resp = await client._request("GET", path, **kwargs)
    return resp.json()


async def _post_json(client: MarketerClient, path: str, **kwargs: Any) -> Any:
    resp = await client._request("POST", path, **kwargs)
    return resp.json()


def _unavailable(exc: MarketerError) -> str:
    """A 409 from a media route means the feature is switched off or
    unconfigured on this deploy. Surface the reason verbatim — the house
    rule is that an unconfigured provider is loudly unavailable, never a
    silent fallback and never an empty list that reads as "no models"."""
    return f"unavailable ({exc.status_code}): {exc.message}"


# ------------------------------------------------------------------ catalogue


async def list_video_models(client_factory: ClientFactory) -> str:
    """Video models the caller can generate with, plus their capabilities.

    Three groups, because they answer different questions:
      * `generation_models` — submittable right now via
        `submit_video_generation` (the studio catalog, with per-model
        aspect ratios / durations / resolutions and the pinned rate card).
      * `pipeline_renderers` — the animation backends a niche's pipeline
        can be configured to use, with `available` reflecting which keys
        this deploy has.
      * `seedance_models` — the Seedance 2.5 capability table (camera
        controls, reference-media arity, character reference, pinned
        per-second prices by resolution). `submittable` says whether the
        studio catalog currently exposes that id.
    """
    result: dict[str, Any] = {}
    async with client_factory() as client:
        try:
            studio = await _get_json(client, UGC_MODELS_PATH)
            result["generation_models"] = studio.get("models", [])
            result["max_reference_images"] = studio.get("max_reference_images")
        except MarketerError as exc:
            result["generation_models"] = []
            result["generation_models_unavailable"] = _unavailable(exc)
        try:
            result["pipeline_renderers"] = await _get_json(client, VIDEO_MODELS_PATH)
        except MarketerError as exc:
            result["pipeline_renderers"] = []
            result["pipeline_renderers_unavailable"] = _unavailable(exc)

    submittable = {m.get("id") for m in result.get("generation_models", []) if isinstance(m, dict)}
    result["seedance_models"] = [
        {**entry, "submittable": entry["id"] in submittable} for entry in seedance.catalog()
    ]
    return _dump(result)


async def list_image_models(client_factory: ClientFactory) -> str:
    """Image models available for stills, with their pinned per-image cost.

    Read-only and free. Image generation is the platform's stock model —
    there is no per-call model choice — so this is a rate card plus the
    supported sizes/qualities, not a menu.
    """
    from ..services import openai_pricing

    # Local read of a pinned price table; no client call is needed, but the
    # factory stays in the signature so every tool in this module has the
    # same shape and can grow an API-backed field without a signature change.
    _ = client_factory
    models = [
        {
            "id": "gpt-image-1",
            "provider": "openai",
            "kind": "text_to_image",
            "sizes": sorted(openai_pricing.GPT_IMAGE_1_USD_PER_IMAGE),
            "cost_basis": {
                "unit": "usd_per_image",
                "by_size": {
                    size: {quality: str(price) for quality, price in tiers.items()}
                    for size, tiers in openai_pricing.GPT_IMAGE_1_USD_PER_IMAGE.items()
                },
            },
        }
    ]
    return _dump({"image_models": models})


# ------------------------------------------------------------------ generation


def _validate_seedance(
    model_id: str,
    *,
    prompt: str,
    image_urls: Iterable[str],
    aspect_ratio: str | None,
    duration: int | None,
    resolution: str | None,
    camera_move: str | None,
) -> str:
    """Capability-check a Seedance request locally and return the final
    prompt (camera move folded in).

    Raises `SeedanceValidationError` for an unknown id or an unsupported
    parameter and `SeedanceDisabled` when no gateway key is configured —
    both before any HTTP call, so an agent's mistake never costs a round
    trip and a missing key never looks like a provider outage.
    """
    # Model identity first: a typo'd id should read as a typo, not as a
    # configuration problem.
    seedance.require_model(model_id)
    seedance.require_enabled()
    req = seedance.build_request(
        model_id,
        prompt=prompt,
        image_urls=list(image_urls),
        aspect_ratio=aspect_ratio,
        duration=duration,
        resolution=resolution,
        camera_move=camera_move,
    )
    return req.prompt


async def submit_video_generation(
    client_factory: ClientFactory,
    *,
    model_id: str,
    prompt: str,
    aspect_ratio: str | None = None,
    duration: int | None = None,
    resolution: str | None = None,
    mode: str | None = None,
    camera_move: str | None = None,
    image_urls: list[str] | None = None,
    niche_id: str | None = None,
) -> str:
    """Submit one video generation. SPENDS MONEY (metered by the API)."""
    urls = [u for u in (image_urls or []) if u]
    final_prompt = prompt
    # A `seedance-2.5-*` id that isn't in the catalog is a typo, not another
    # vendor's model, so it takes the local validator (and its "known: ..."
    # message) rather than a server-side 400.
    if seedance.get_model(model_id) is not None or model_id.startswith(_SEEDANCE_PREFIX):
        final_prompt = _validate_seedance(
            model_id,
            prompt=prompt,
            image_urls=urls,
            aspect_ratio=aspect_ratio,
            duration=duration,
            resolution=resolution,
            camera_move=camera_move,
        )
    elif camera_move:
        # Camera tokens are a Seedance capability; silently dropping the
        # argument for another model would render something the caller
        # did not ask for.
        raise ValueError(
            f"camera_move is only supported by Seedance models "
            f"({', '.join(m.id for m in seedance.list_models())}), not {model_id!r}"
        )

    body: dict[str, Any] = {"model_id": model_id, "prompt": final_prompt, "image_urls": urls}
    for key, value in (
        ("aspect_ratio", aspect_ratio),
        ("duration", duration),
        ("resolution", resolution),
        ("mode", mode),
        ("niche_id", niche_id),
    ):
        if value is not None and value != "":
            body[key] = value

    async with client_factory() as client:
        return _dump(await _post_json(client, UGC_RENDERS_PATH, json=body))


async def list_video_generations(
    client_factory: ClientFactory,
    *,
    status: str | None = None,
    limit: int = 50,
) -> str:
    """The caller's recent generations, newest first. Read-only."""
    params: dict[str, Any] = {"limit": max(1, min(int(limit), 200))}
    if status:
        params["status_filter"] = status
    async with client_factory() as client:
        return _dump(await _get_json(client, UGC_RENDERS_PATH, params=params))


async def get_video_generation(client_factory: ClientFactory, generation_id: str) -> str:
    """One generation's current state. Read-only (reconciles with the
    provider on read, so a missed completion webhook still resolves)."""
    async with client_factory() as client:
        return _dump(await _get_json(client, f"{UGC_RENDERS_PATH}/{generation_id}"))


async def get_generation_asset(client_factory: ClientFactory, generation_id: str) -> str:
    """The finished asset's URL, or an explicit not-ready/failed answer.

    Never returns an empty `video_url` as if it were an asset: an agent
    that pastes a blank URL into a post is worse than one that waits.
    """
    async with client_factory() as client:
        row = await _get_json(client, f"{UGC_RENDERS_PATH}/{generation_id}")

    status = str(row.get("status") or "").lower()
    video_url = row.get("video_url") or ""
    payload: dict[str, Any] = {
        "generation_id": str(row.get("id") or generation_id),
        "status": status,
        "model_id": row.get("model_id"),
    }
    if status in _DONE_STATUSES and video_url:
        payload["ready"] = True
        payload["video_url"] = video_url
        return _dump(payload)
    payload["ready"] = False
    if status in _FAILED_STATUSES:
        payload["error"] = row.get("error") or "generation failed"
    else:
        payload["detail"] = "still rendering — poll again in a few seconds"
    return _dump(payload)


async def retry_video_generation(client_factory: ClientFactory, generation_id: str) -> str:
    """Re-submit a failed generation. SPENDS MONEY (metered by the API)."""
    async with client_factory() as client:
        return _dump(await _post_json(client, f"{UGC_RENDERS_PATH}/{generation_id}/retry"))


# ------------------------------------------------------------------ registration

_SPEND_WARNING = (
    "EXPENSIVE: bills the provider per rendered second against the niche's "
    "daily cap, the account's global cap and prepaid credit — the same "
    "metering the HTTP API enforces; a cap breach returns a 402 error. "
    "Always confirm with the user before calling."
)


def register(mcp: Any, client_factory: ClientFactory) -> None:
    """Bind the media tools onto an existing FastMCP server.

    `mcp` is the `FastMCP` instance built in `mcp_server.build_server`;
    `client_factory` is that function's local `_client`, so these tools
    inherit the server's base URL and personal access token rather than
    reading any credential of their own.
    """

    @mcp.tool(name="list_video_models", description=(
        "List video models the user can generate with, and what each one "
        "supports: aspect ratios, durations, resolutions, reference-image "
        "limits, Seedance camera controls and character reference, plus the "
        "pinned USD-per-second rate card. Cheap, read-only. Call this before "
        "submit_video_generation so you pick a model that actually supports "
        "the parameters you want."
    ))
    async def list_video_models_tool() -> str:
        return await list_video_models(client_factory)

    @mcp.tool(name="list_image_models", description=(
        "List image models with their supported sizes/qualities and pinned "
        "per-image cost. Cheap, read-only."
    ))
    async def list_image_models_tool() -> str:
        return await list_image_models(client_factory)

    @mcp.tool(name="submit_video_generation", description=(
        "Submit one video generation and return the queued generation row "
        "(id + status); rendering finishes asynchronously, so poll "
        "get_video_generation or get_generation_asset afterwards. model_id "
        "must come from list_video_models. Unsupported aspect ratio, "
        "duration, resolution or camera_move is rejected before any spend. "
        "camera_move (e.g. 'dolly_in', 'orbit_left') applies to Seedance "
        "models only. " + _SPEND_WARNING
    ))
    async def submit_video_generation_tool(
        model_id: str,
        prompt: str,
        aspect_ratio: str | None = None,
        duration: int | None = None,
        resolution: str | None = None,
        mode: str | None = None,
        camera_move: str | None = None,
        image_urls: list[str] | None = None,
        niche_id: str | None = None,
    ) -> str:
        return await submit_video_generation(
            client_factory,
            model_id=model_id,
            prompt=prompt,
            aspect_ratio=aspect_ratio,
            duration=duration,
            resolution=resolution,
            mode=mode,
            camera_move=camera_move,
            image_urls=image_urls,
            niche_id=niche_id,
        )

    @mcp.tool(name="list_video_generations", description=(
        "List the caller's recent video generations, newest first. Cheap, "
        "read-only. Filter with status (queued|running|done|failed)."
    ))
    async def list_video_generations_tool(status: str | None = None, limit: int = 50) -> str:
        return await list_video_generations(client_factory, status=status, limit=limit)

    @mcp.tool(name="get_video_generation", description=(
        "Check one video generation: status, model, parameters, error. "
        "Cheap, read-only — it also reconciles with the provider, so a "
        "generation whose completion callback was lost still resolves here."
    ))
    async def get_video_generation_tool(generation_id: str) -> str:
        return await get_video_generation(client_factory, generation_id)

    @mcp.tool(name="get_generation_asset", description=(
        "Fetch a finished generation's downloadable video URL. Cheap, "
        "read-only. Returns {ready:false, ...} while it is still rendering "
        "or if it failed — never a blank URL. Poll this until ready."
    ))
    async def get_generation_asset_tool(generation_id: str) -> str:
        return await get_generation_asset(client_factory, generation_id)

    @mcp.tool(name="retry_video_generation", description=(
        "Re-submit a generation that failed (only works from the 'failed' "
        "state). " + _SPEND_WARNING
    ))
    async def retry_video_generation_tool(generation_id: str) -> str:
        return await retry_video_generation(client_factory, generation_id)

    # Touch the closures so linters don't read them as dead code: FastMCP
    # keeps its own references via the decorator.
    _: tuple[Callable[..., Awaitable[str]], ...] = (
        list_video_models_tool,
        list_image_models_tool,
        submit_video_generation_tool,
        list_video_generations_tool,
        get_video_generation_tool,
        get_generation_asset_tool,
        retry_video_generation_tool,
    )
