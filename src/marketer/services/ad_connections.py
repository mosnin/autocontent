"""Connect ad platforms to a user via Composio OAuth, persisting the result in
ad_accounts. Thin orchestration over composio_client + repos/ads; every
Composio call can raise AdsDisabled, which callers surface as a clean 4xx."""
from __future__ import annotations

from uuid import UUID

from ..repos import ads as ads_repo
from ..repos.ads import AdAccount
from . import composio_client

# Composio connection statuses → our ad_account.status vocabulary.
_ACTIVE = {"ACTIVE"}
_FAILED = {"FAILED", "EXPIRED", "DELETED", "INACTIVE"}


def _map_status(composio_status: str) -> str:
    s = composio_status.upper()
    if s in _ACTIVE:
        return "active"
    if s in _FAILED:
        return "error"
    return "pending"


async def start_connection(*, user_id: str, platform: str) -> dict:
    """Begin an OAuth connection. Creates/updates a pending ad_account holding
    the Composio connection id and returns the redirect URL the user opens to
    authorize. Raises AdsDisabled if the feature/platform isn't configured."""
    init = composio_client.initiate_connection(user_id=user_id, platform=platform)
    account = await ads_repo.create_account(
        user_id=user_id,
        platform=platform,
        composio_connection_id=init.connection_id,
        status="pending",
    )
    return {
        "account_id": str(account.id),
        "redirect_url": init.redirect_url,
        "platform": platform,
    }


async def refresh_status(*, user_id: str, account_id: UUID) -> AdAccount | None:
    """Poll Composio for the connection's live status and mirror it onto the
    ad_account. No-op (returns the account unchanged) if it has no connection
    id yet."""
    account = await ads_repo.get_account(account_id, user_id=user_id)
    if account is None:
        return None
    if not account.composio_connection_id:
        return account
    try:
        raw = composio_client.connection_status(
            connection_id=account.composio_connection_id
        )
    except composio_client.AdsDisabled:
        # Feature turned off mid-flight; leave the stored status alone.
        return account
    mapped = _map_status(raw)
    if mapped == account.status:
        return account
    return await ads_repo.set_account_status(
        account_id, user_id=user_id, status=mapped
    )


async def disconnect(*, user_id: str, account_id: UUID) -> AdAccount | None:
    """Revoke the Composio connection and mark the account disconnected. Best-
    effort on the Composio side; the local status flip always happens."""
    account = await ads_repo.get_account(account_id, user_id=user_id)
    if account is None:
        return None
    if account.composio_connection_id:
        try:
            composio_client.disconnect(
                connection_id=account.composio_connection_id
            )
        except composio_client.AdsDisabled:
            pass
    return await ads_repo.set_account_status(
        account_id, user_id=user_id, status="disconnected"
    )
