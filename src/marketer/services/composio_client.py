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
