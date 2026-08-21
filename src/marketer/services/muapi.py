"""MUAPI provider client for the UGC studio (async, webhook-delivered).

API shape (ported from the Open AI UGC studio's generate/creations routes):

  POST {base}/{model-endpoint}
    x-api-key: $MARKETER_MUAPI_API_KEY
    body: {
      "prompt": "...",
      "image_url": "https://...",      # first reference image, if any
      "images_list": ["https://...", ...],
      "webhook_url": "https://us/api/v1/ugc/webhook?token=...",
      "aspect_ratio": "9:16", "duration": 6, "resolution": "480p", "mode": "normal"
    }
  -> 200 { "request_id": "..." }        # some responses key it "id"

  GET {base}/predictions/{request_id}/result
    x-api-key: ...
  -> 200 { "status": "completed"|"failed"|"processing"|...,
           "outputs": ["https://...mp4"], "error": "" }

The render then completes *out of band*: MUAPI POSTs the same result
document to `webhook_url`. The GET above is only the reconciliation path
for deliveries that never arrive (bad webhook config, transient 5xx on
our side, a run started before the webhook URL was set).

Both the primary `image_url` and the full `images_list` are sent, exactly
as the source does — different models behind the gateway read different
fields, and sending both is what makes one payload work across all four.

Config gating: `enabled()` is false unless `MARKETER_UGC_ENABLED` is true
AND `MARKETER_MUAPI_API_KEY` is set. Every entry point raises
`MuapiDisabled` in that state so the route can answer 409 instead of
surfacing a 500 or an auth error from the provider.
"""
from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from ..config import settings
from ..logging import get_logger

log = get_logger(__name__)

PROVIDER = "muapi"
HTTP_TIMEOUT_SEC = 60.0

# Our own inbound path; MUAPI is told to call it. Kept here (not in the
# route module) so the client can build a complete webhook URL without
# importing FastAPI.
WEBHOOK_PATH = "/api/v1/ugc/webhook"

# Provider status strings -> our render statuses. Anything unrecognized is
# treated as still-running: a status we don't know is not evidence that a
# paid render failed.
_TERMINAL_OK = {"completed", "succeeded", "success", "done"}
_TERMINAL_FAIL = {"failed", "error", "canceled", "cancelled", "expired"}

STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_DONE = "done"
STATUS_FAILED = "failed"


class MuapiError(RuntimeError):
    """The provider rejected or malformed a request."""


class MuapiDisabled(RuntimeError):
    """UGC is switched off or unconfigured — fail closed, never 500."""


def enabled() -> bool:
    return bool(settings.ugc_enabled and settings.muapi_api_key)


def require_enabled() -> None:
    if not settings.ugc_enabled:
        raise MuapiDisabled("the UGC studio is disabled (set MARKETER_UGC_ENABLED=true)")
    if not settings.muapi_api_key:
        raise MuapiDisabled("the UGC studio is unconfigured (MARKETER_MUAPI_API_KEY is not set)")


def webhook_url() -> str:
    """Completion callback URL handed to MUAPI, secret included.

    Empty when either the public origin or the shared secret is missing —
    an unauthenticated callback URL is worse than none, because the
    inbound route refuses tokenless deliveries anyway and we would just be
    publishing our endpoint to a third party for nothing. With no webhook
    URL the render still completes; it is reconciled by polling instead.
    """
    origin = (settings.muapi_webhook_url or "").rstrip("/")
    if not origin or not settings.muapi_webhook_secret:
        return ""
    query = urlencode({"token": settings.muapi_webhook_secret})
    return f"{origin}{WEBHOOK_PATH}?{query}"


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=settings.muapi_base_url.rstrip("/"),
        timeout=HTTP_TIMEOUT_SEC,
        headers={
            "x-api-key": settings.muapi_api_key,
            "Content-Type": "application/json",
        },
    )


def _is_retryable(exc: BaseException) -> bool:
    """Retry rate limits, 5xx, and transport faults only.

    Deterministic 4xx (bad params, no credit on the MUAPI account, bad
    key) fail identically on retry. Mirrors fal_video._is_retryable.
    """
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code == 429 or exc.response.status_code >= 500
    return isinstance(exc, httpx.HTTPError)


def build_payload(
    *,
    prompt: str,
    image_urls: list[str],
    params: dict[str, Any],
    callback_url: str = "",
) -> dict[str, Any]:
    """The submit body. `params` is the validated settings dict from the
    catalog, so only knobs the model actually declares are ever sent."""
    body: dict[str, Any] = {"prompt": prompt, **params}
    if image_urls:
        # Both shapes, deliberately: some models behind the gateway read
        # `image_url`, the multi-reference ones read `images_list`.
        body["image_url"] = image_urls[0]
        body["images_list"] = list(image_urls)
    if callback_url:
        body["webhook_url"] = callback_url
    return body


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=16),
    retry=retry_if_exception(_is_retryable),
)
async def _post(client: httpx.AsyncClient, endpoint: str, body: dict[str, Any]) -> dict:
    # NOTE: this enqueues a *paid* render. Retries only fire for transport
    # faults and 429/5xx — never for a request MUAPI actually rejected —
    # but a lost response on a request that did land would re-submit and
    # pay twice. MUAPI exposes no client idempotency key, so the residual
    # risk is the same one accepted in fal_video._submit, for the same
    # reason: never retrying would fail every render that hits a blip.
    resp = await client.post(f"/{endpoint.lstrip('/')}", json=body)
    resp.raise_for_status()
    return resp.json()


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=16),
    retry=retry_if_exception(_is_retryable),
)
async def _get(client: httpx.AsyncClient, path: str) -> dict:
    resp = await client.get(path)
    resp.raise_for_status()
    return resp.json()


async def submit(
    *,
    endpoint: str,
    prompt: str,
    image_urls: list[str],
    params: dict[str, Any],
) -> str:
    """Enqueue a render; return MUAPI's request id."""
    from ..billing.gates import raise_if_unbilled

    raise_if_unbilled()
    require_enabled()
    body = build_payload(
        prompt=prompt,
        image_urls=image_urls,
        params=params,
        callback_url=webhook_url(),
    )
    async with _client() as client:
        data = await _post(client, endpoint, body)
    request_id = data.get("request_id") or data.get("id")
    if not request_id:
        raise MuapiError(f"submit response carried no request id: {data!r}")
    log.info("muapi.submitted", extra={"provider": PROVIDER, "sku": endpoint})
    return str(request_id)


async def fetch_result(request_id: str) -> dict:
    """Poll one prediction — the reconciliation path for missed webhooks."""
    require_enabled()
    async with _client() as client:
        return await _get(client, f"/predictions/{request_id}/result")


def parse_result(payload: dict[str, Any]) -> tuple[str, str, str]:
    """Normalize a result/webhook document to (status, video_url, error).

    Status handling follows the source's webhook precedence — an explicit
    failure or a non-empty `error` wins over everything, then a completed
    status or the mere presence of outputs means done — but adds the case
    the source gets wrong: "completed" with an empty `outputs` array is a
    FAILURE here, not a done render with a null video URL that the UI
    would render as a broken player forever.
    """
    status = str(payload.get("status") or "").strip().lower()
    error = str(payload.get("error") or "").strip()
    outputs = payload.get("outputs") or []
    if isinstance(outputs, str):
        outputs = [outputs]
    video_url = ""
    for item in outputs:
        if isinstance(item, str) and item:
            video_url = item
            break
        if isinstance(item, dict):
            candidate = item.get("url") or item.get("video_url") or ""
            if candidate:
                video_url = str(candidate)
                break

    if status in _TERMINAL_FAIL or error:
        return STATUS_FAILED, "", error or f"render {status or 'failed'}"
    if status in _TERMINAL_OK or video_url:
        if not video_url:
            return STATUS_FAILED, "", "provider reported completion with no output video"
        return STATUS_DONE, video_url, ""
    return STATUS_RUNNING, "", ""


def extract_request_id(payload: dict[str, Any]) -> str:
    """Webhook bodies key the id as `id` or `request_id` depending on model."""
    return str(payload.get("request_id") or payload.get("id") or "").strip()
