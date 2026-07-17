"""Composio adapter — the single boundary between marketer.sh and the Composio
SDK (per-user OAuth to ad platforms + agent tool access).

Design rules:
- **Config-gated.** Inert unless ``ads_enabled`` AND ``composio_api_key`` are
  set. Every entry point raises ``AdsDisabled`` otherwise, so nothing here can
  reach an ad platform by accident.
- **Lazy import.** The ``composio`` package is imported inside functions, so the
  app and the whole test suite run without it installed. A missing package
  surfaces as ``AdsDisabled`` with a clear message, never an ImportError at
  module load.
- **Thin + mockable.** All real network calls funnel through the small function
  set here; tests monkeypatch these, so no real Composio call is ever made in
  CI or the sandbox.
"""
from __future__ import annotations

from dataclasses import dataclass

from ..config import settings

# Composio toolkit slugs for the ad platforms we support.
TOOLKITS: dict[str, str] = {
    "google_ads": "GOOGLEADS",
    "meta_ads": "METAADS",
}


class AdsDisabled(RuntimeError):
    """Raised when an ads/Composio operation is attempted while the feature is
    off or misconfigured. Callers surface this as a clean 4xx, never a 500."""


class ComposioCallError(RuntimeError):
    """A Composio tool call executed but the platform reported failure, or its
    response couldn't be parsed into what we needed. Distinct from
    AdsDisabled: the feature IS configured, this specific call did not
    succeed. Callers surface this as a 502 — never silently swallowed into a
    fake success."""


@dataclass(frozen=True)
class ConnectionInit:
    """Result of starting an OAuth connection: the URL the user must visit and
    the connection id we persist to poll/complete it."""

    connection_id: str
    redirect_url: str


def is_enabled() -> bool:
    return bool(settings.ads_enabled and settings.composio_api_key)


def platform_auth_config(platform: str) -> str | None:
    """The Composio auth-config id for a platform, or None if unconfigured
    (that platform can't be connected)."""
    return {
        "google_ads": settings.composio_googleads_auth_config_id or None,
        "meta_ads": settings.composio_metaads_auth_config_id or None,
    }.get(platform)


def _require_enabled() -> None:
    if not is_enabled():
        raise AdsDisabled(
            "Ads/Composio is disabled — set MARKETER_ADS_ENABLED=true and "
            "MARKETER_COMPOSIO_API_KEY."
        )


def _client():
    """Construct a Composio client. Lazy so the package is optional."""
    _require_enabled()
    try:
        from composio import Composio  # type: ignore
    except Exception as e:  # noqa: BLE001 — package optional
        raise AdsDisabled(f"composio package not available: {e}") from e
    return Composio(api_key=settings.composio_api_key)


def initiate_connection(*, user_id: str, platform: str) -> ConnectionInit:
    """Start an OAuth connection for a user on a platform. Returns the redirect
    URL to send them to and the connection id to persist."""
    if platform not in TOOLKITS:
        raise AdsDisabled(f"platform {platform!r} is not connectable")
    auth_config_id = platform_auth_config(platform)
    if not auth_config_id:
        raise AdsDisabled(f"no Composio auth config for {platform!r}")
    client = _client()
    req = client.connected_accounts.initiate(
        user_id=user_id, auth_config_id=auth_config_id
    )
    return ConnectionInit(
        connection_id=getattr(req, "id", "") or "",
        redirect_url=getattr(req, "redirect_url", "") or "",
    )


def connection_status(*, connection_id: str) -> str:
    """Poll a connection's status ('ACTIVE', 'INITIATED', 'FAILED', ...)."""
    client = _client()
    conn = client.connected_accounts.get(connection_id)
    return str(getattr(conn, "status", "") or "")


def disconnect(*, connection_id: str) -> None:
    client = _client()
    client.connected_accounts.delete(connection_id)


def get_agent_tools(*, user_id: str, platform: str) -> list:
    """Fetch the toolkit's tools for a user, formatted for the OpenAI Agents
    SDK provider, to hand to an Agent. Requires the connection to be active."""
    _require_enabled()
    try:
        from composio import Composio  # type: ignore
        from composio_openai_agents import OpenAIAgentsProvider  # type: ignore
    except Exception as e:  # noqa: BLE001
        raise AdsDisabled(f"composio openai-agents provider not available: {e}") from e
    toolkit = TOOLKITS.get(platform)
    if not toolkit:
        raise AdsDisabled(f"platform {platform!r} has no toolkit")
    client = Composio(api_key=settings.composio_api_key, provider=OpenAIAgentsProvider())
    return client.tools.get(user_id=user_id, toolkits=[toolkit])


def execute_tool(*, user_id: str, slug: str, arguments: dict) -> dict:
    """Execute a single Composio tool directly and return its raw result dict.
    Spend-affecting slugs must ONLY be called via the safe-execute layer, never
    directly — this function does no governance."""
    client = _client()
    result = client.tools.execute(slug, user_id=user_id, arguments=arguments)
    # Normalize to a dict regardless of SDK return shape.
    if isinstance(result, dict):
        return result
    return {
        "successful": getattr(result, "successful", None),
        "data": getattr(result, "data", None),
        "error": getattr(result, "error", None),
    }


# --------------------------------------------------------------------------- typed platform ops
#
# Composio tool slugs are per-platform + per-op config (settings.composio_*),
# overridable per deploy because Composio renames actions upstream. An empty
# slug means that op is unconfigured for that platform — fail-closed with
# AdsDisabled rather than guessing a slug or silently no-oping. Every op here
# is gated by is_enabled() (via _require_enabled()/execute_tool->_client()).

_TOOL_SLUGS: dict[str, dict[str, str]] = {
    "google_ads": {
        "create_campaign": "composio_googleads_create_campaign_tool",
        "set_status": "composio_googleads_set_status_tool",
        "set_budget": "composio_googleads_set_budget_tool",
        "metrics": "composio_googleads_metrics_tool",
    },
    "meta_ads": {
        "create_campaign": "composio_metaads_create_campaign_tool",
        "set_status": "composio_metaads_set_status_tool",
        "set_budget": "composio_metaads_set_budget_tool",
        "metrics": "composio_metaads_metrics_tool",
    },
}


def _tool_slug(platform: str, op: str) -> str:
    """Resolve the configured Composio tool slug for platform+op. Raises
    AdsDisabled (fail-closed) when the platform is unknown or the slug is
    blank — never falls back to a guess."""
    attr = _TOOL_SLUGS.get(platform, {}).get(op)
    slug = getattr(settings, attr, "") if attr else ""
    if not slug:
        raise AdsDisabled(f"no Composio tool configured for {platform}/{op}")
    return slug


def _unwrap(raw: dict, *, op: str) -> dict:
    """Defensively unwrap execute_tool's result. Composio's response shape
    varies by SDK version/toolkit; this tolerates a few and always surfaces
    failure clearly rather than returning something that looks like success."""
    if raw.get("successful") is False:
        raise ComposioCallError(f"{op} failed: {raw.get('error') or 'unknown error'}")
    data = raw.get("data", raw)
    if isinstance(data, dict):
        return data
    if isinstance(data, list):
        return {"rows": data}
    return {}


def _first(data: dict, *keys: str) -> str:
    """First present, non-empty string value among *keys* — tolerant of
    Composio's varying field names across toolkits/versions."""
    for k in keys:
        v = data.get(k)
        if v:
            return str(v)
    return ""


def _num(row: dict, *keys: str):
    for k in keys:
        v = row.get(k)
        if v not in (None, ""):
            return v
    return 0


def create_campaign(
    *, user_id: str, connected_account_id: str, platform: str, payload: dict
) -> dict:
    """Create a campaign on *platform* for the user's connected account.
    Returns ``{"external_campaign_id": str, "raw": dict}``. Raises
    AdsDisabled if unconfigured/disabled, ComposioCallError if the platform
    call executes but fails or returns no usable campaign id."""
    _require_enabled()
    slug = _tool_slug(platform, "create_campaign")
    raw = execute_tool(
        user_id=user_id, slug=slug,
        arguments={"connected_account_id": connected_account_id, **payload},
    )
    data = _unwrap(raw, op=f"{platform}.create_campaign")
    external_id = _first(
        data, "id", "campaign_id", "external_campaign_id", "resource_name", "resourceName"
    )
    if not external_id:
        raise ComposioCallError(
            f"{platform}.create_campaign returned no campaign id: {data!r}"
        )
    return {"external_campaign_id": external_id, "raw": data}


def set_campaign_status(
    *,
    user_id: str,
    connected_account_id: str,
    platform: str,
    external_campaign_id: str,
    status: str,
) -> dict:
    """Set a campaign's status ('active' | 'paused' | 'ended') on the
    platform. Returns the raw (unwrapped) result dict."""
    _require_enabled()
    slug = _tool_slug(platform, "set_status")
    raw = execute_tool(
        user_id=user_id, slug=slug,
        arguments={
            "connected_account_id": connected_account_id,
            "campaign_id": external_campaign_id,
            "status": status,
        },
    )
    return _unwrap(raw, op=f"{platform}.set_status")


def set_budget(
    *,
    user_id: str,
    connected_account_id: str,
    platform: str,
    external_campaign_id: str,
    daily_budget_usd,
) -> dict:
    """Set a campaign's daily budget on the platform. Returns the raw
    (unwrapped) result dict. Callers (the safe-execute layer) are solely
    responsible for governance — this function does none."""
    _require_enabled()
    slug = _tool_slug(platform, "set_budget")
    raw = execute_tool(
        user_id=user_id, slug=slug,
        arguments={
            "connected_account_id": connected_account_id,
            "campaign_id": external_campaign_id,
            "daily_budget": str(daily_budget_usd),
        },
    )
    return _unwrap(raw, op=f"{platform}.set_budget")


def fetch_metrics(
    *, user_id: str, connected_account_id: str, platform: str, date_from, date_to
) -> list[dict]:
    """Pull a daily performance report for *date_from*..*date_to* (inclusive).
    Returns rows tolerantly parsed into
    ``{campaign_id, date, impressions, clicks, spend_usd, conversions,
    revenue_usd}`` where ``campaign_id`` is the PLATFORM's external campaign
    id (callers map this back to our internal campaign). Rows with no
    identifiable campaign id are dropped rather than guessed."""
    _require_enabled()
    slug = _tool_slug(platform, "metrics")
    date_to_s = date_to.isoformat() if hasattr(date_to, "isoformat") else str(date_to)
    date_from_s = date_from.isoformat() if hasattr(date_from, "isoformat") else str(date_from)
    raw = execute_tool(
        user_id=user_id, slug=slug,
        arguments={
            "connected_account_id": connected_account_id,
            "date_from": date_from_s,
            "date_to": date_to_s,
        },
    )
    data = _unwrap(raw, op=f"{platform}.metrics")
    rows = data.get("rows") or data.get("results") or data.get("data") or []
    if isinstance(rows, dict):
        rows = [rows]
    parsed: list[dict] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        campaign_id = _first(r, "campaign_id", "campaignId", "id")
        if not campaign_id:
            continue
        parsed.append(
            {
                "campaign_id": campaign_id,
                # Some report toolkits return an aggregate row with no
                # per-row date; attribute it to the window's end date rather
                # than dropping it.
                "date": _first(r, "date", "day", "segments.date") or date_to_s,
                "impressions": _num(r, "impressions"),
                "clicks": _num(r, "clicks"),
                "spend_usd": _num(r, "spend_usd", "spend", "cost", "cost_usd"),
                "conversions": _num(r, "conversions"),
                "revenue_usd": _num(r, "revenue_usd", "revenue", "conversions_value"),
            }
        )
    return parsed
