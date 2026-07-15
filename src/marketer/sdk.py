"""Thin async client around the marketer FastAPI backend.

Auth: pass a personal access token (``mkt_...``) explicitly via ``token``
or set ``MARKETER_API_TOKEN`` in the environment. The base URL comes
from ``base_url`` or ``MARKETER_API_BASE_URL``.

Every method returns pydantic models from ``marketer.models``.
"""
from __future__ import annotations

import os
from typing import Any
from uuid import UUID

import httpx

from .articles.models import Article, ArticleStatus
from .models import (
    AyrshareConnectResponse,
    AyrshareConnectStatus,
    Job,
    JobStatus,
    Niche,
    NicheCreatePayload,
    PersonalAccessToken,
    TodaySpend,
)

ENV_BASE_URL = "MARKETER_API_BASE_URL"
ENV_TOKEN = "MARKETER_API_TOKEN"


class MarketerError(Exception):
    """Raised on non-2xx responses from the backend."""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(f"{status_code}: {message}")
        self.status_code = status_code
        self.message = message


def _require(value: str | None, env_var: str, ctor_arg: str) -> str:
    if not value:
        raise RuntimeError(
            f"missing {ctor_arg} (set {env_var} or pass {ctor_arg}= to MarketerClient)"
        )
    return value


class MarketerClient:
    """Async client. Use as a context manager or call ``aclose()`` yourself."""

    def __init__(
        self,
        *,
        base_url: str | None = None,
        token: str | None = None,
        timeout: float = 30.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        base = _require(base_url or os.environ.get(ENV_BASE_URL), ENV_BASE_URL, "base_url")
        tok = _require(token or os.environ.get(ENV_TOKEN), ENV_TOKEN, "token")
        self._base_url = base.rstrip("/")
        self._token = tok
        client_kwargs: dict[str, Any] = {
            "base_url": self._base_url,
            "timeout": timeout,
            "headers": {
                "authorization": f"Bearer {self._token}",
                "content-type": "application/json",
            },
        }
        if transport is not None:
            client_kwargs["transport"] = transport
        self._client = httpx.AsyncClient(**client_kwargs)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "MarketerClient":
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    # ------------------------------------------------------------------ HTTP

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
    ) -> httpx.Response:
        resp = await self._client.request(method, path, params=params, json=json)
        if resp.status_code >= 400:
            try:
                detail = resp.json()
            except Exception:
                detail = resp.text
            raise MarketerError(resp.status_code, str(detail))
        return resp

    # ------------------------------------------------------------------ niches

    async def list_niches(self) -> list[Niche]:
        resp = await self._request("GET", "/api/v1/niches")
        return [Niche.model_validate(r) for r in resp.json()]

    async def get_niche(self, niche_id: UUID | str) -> Niche:
        resp = await self._request("GET", f"/api/v1/niches/{niche_id}")
        return Niche.model_validate(resp.json())

    async def create_niche(self, payload: NicheCreatePayload) -> Niche:
        body = payload.model_dump(mode="json")
        resp = await self._request("POST", "/api/v1/niches", json=body)
        return Niche.model_validate(resp.json())

    async def archive_niche(self, niche_id: UUID | str) -> None:
        await self._request("DELETE", f"/api/v1/niches/{niche_id}")

    # ------------------------------------------------------------------ jobs

    async def list_jobs(
        self,
        *,
        status: JobStatus | str | None = None,
        limit: int = 50,
    ) -> list[Job]:
        params: dict[str, Any] = {"limit": limit}
        if status is not None:
            params["status_filter"] = status.value if isinstance(status, JobStatus) else status
        resp = await self._request("GET", "/api/v1/jobs", params=params)
        return [Job.model_validate(r) for r in resp.json()]

    async def get_job(self, job_id: UUID | str) -> Job:
        resp = await self._request("GET", f"/api/v1/jobs/{job_id}")
        return Job.model_validate(resp.json())

    async def enqueue_job(self, *, niche_id: UUID | str, platform: str) -> Job:
        body = {"niche_id": str(niche_id), "platform": platform}
        resp = await self._request("POST", "/api/v1/jobs", json=body)
        return Job.model_validate(resp.json())

    async def retry_job(self, job_id: UUID | str) -> Job:
        resp = await self._request("POST", f"/api/v1/jobs/{job_id}/retry")
        return Job.model_validate(resp.json())

    # --------------------------------------------------------------- articles

    async def list_articles(
        self,
        *,
        status: ArticleStatus | str | None = None,
        niche_id: UUID | str | None = None,
        limit: int = 50,
    ) -> list[Article]:
        params: dict[str, Any] = {"limit": limit}
        if status is not None:
            params["status_filter"] = status.value if isinstance(status, ArticleStatus) else status
        if niche_id is not None:
            params["niche_id"] = str(niche_id)
        resp = await self._request("GET", "/api/v1/articles", params=params)
        return [Article.model_validate(r) for r in resp.json()]

    async def get_article(self, article_id: UUID | str) -> Article:
        resp = await self._request("GET", f"/api/v1/articles/{article_id}")
        return Article.model_validate(resp.json())

    async def get_article_markdown(self, article_id: UUID | str) -> str:
        resp = await self._request("GET", f"/api/v1/articles/{article_id}/markdown")
        return resp.text

    async def generate_article(
        self, *, niche_id: UUID | str, topic: str = ""
    ) -> Article:
        body = {"niche_id": str(niche_id), "topic": topic}
        resp = await self._request("POST", "/api/v1/articles", json=body)
        return Article.model_validate(resp.json())

    async def retry_article(self, article_id: UUID | str) -> Article:
        resp = await self._request("POST", f"/api/v1/articles/{article_id}/retry")
        return Article.model_validate(resp.json())

    async def repurpose_article(
        self, article_id: UUID | str, *, platforms: list[str] | None = None
    ) -> list[dict]:
        """Repurpose a finished article into platform-native social posts.
        Returns a list of {platform, body, hashtags}. Spends (metered to the
        niche cap)."""
        body = {"platforms": platforms or []}
        resp = await self._request(
            "POST", f"/api/v1/articles/{article_id}/social", json=body
        )
        return resp.json().get("snippets", [])

    # ------------------------------------------------------------------ calendar

    async def calendar(self, *, days: int = 30) -> list[dict]:
        """Scheduled videos + article activity for the next `days`. Returns a
        time-ordered list of {kind, id, niche_id, title, status, platform, at}."""
        resp = await self._request("GET", "/api/v1/calendar", params={"days": days})
        return resp.json()

    # ------------------------------------------------------------------ brand kit

    async def get_brand_kit(self) -> dict:
        resp = await self._request("GET", "/api/v1/brand-kit")
        return resp.json()

    async def set_brand_kit(self, **fields: object) -> dict:
        """Upsert the brand kit. Any of: brand_name, tagline, tone_of_voice,
        target_audience, banned_words[], preferred_hashtags[], color_hex."""
        resp = await self._request("PUT", "/api/v1/brand-kit", json=fields)
        return resp.json()

    # ------------------------------------------------------------------ ads

    async def list_ad_accounts(self) -> list[dict]:
        resp = await self._request("GET", "/api/v1/ads/accounts")
        return resp.json()

    async def connect_ad_account(self, platform: str) -> dict:
        """Start an OAuth connection for an ad platform ('google_ads' |
        'meta_ads'). Returns {redirect_url, account_id}; the user must open the
        URL to authorize. Raises MarketerError(409) if ads aren't enabled."""
        resp = await self._request(
            "POST", "/api/v1/ads/accounts/connect", json={"platform": platform}
        )
        return resp.json()

    async def ads_overview(self) -> dict:
        resp = await self._request("GET", "/api/v1/ads/overview")
        return resp.json()

    async def list_ad_campaigns(self, *, account_id: str | None = None) -> list[dict]:
        params = {"account_id": account_id} if account_id else None
        resp = await self._request("GET", "/api/v1/ads/campaigns", params=params)
        return resp.json()

    async def get_ad_campaign(self, campaign_id: str) -> dict:
        resp = await self._request("GET", f"/api/v1/ads/campaigns/{campaign_id}")
        return resp.json()

    async def create_ad_campaign(
        self,
        *,
        ad_account_id: str,
        name: str,
        objective: str = "",
        daily_budget_usd: str | None = None,
    ) -> dict:
        """Create a DRAFT campaign — no spend until activated. Cheap."""
        body = {
            "ad_account_id": ad_account_id, "name": name, "objective": objective,
            "daily_budget_usd": daily_budget_usd,
        }
        resp = await self._request("POST", "/api/v1/ads/campaigns", json=body)
        return resp.json()

    async def change_ad_budget(self, campaign_id: str, daily_budget_usd: str) -> dict:
        """Change a campaign's daily budget. Goes through the fail-closed spend
        guard: may return {status:'pending_approval'} for large deltas, or raise
        MarketerError(402) if denied (cap/kill-switch)."""
        resp = await self._request(
            "POST", f"/api/v1/ads/campaigns/{campaign_id}/budget",
            json={"daily_budget_usd": daily_budget_usd},
        )
        return resp.json()

    async def change_ad_status(self, campaign_id: str, status: str) -> dict:
        """Activate / pause / end a campaign ('active'|'paused'|'ended')."""
        resp = await self._request(
            "POST", f"/api/v1/ads/campaigns/{campaign_id}/status",
            json={"status": status},
        )
        return resp.json()

    async def list_ad_approvals(self, *, status: str | None = None) -> list[dict]:
        params = {"status_filter": status} if status else None
        resp = await self._request("GET", "/api/v1/ads/approvals", params=params)
        return resp.json()

    async def decide_ad_approval(self, approval_id: str, decision: str) -> dict:
        """Approve or reject a pending spend change ('approved'|'rejected')."""
        resp = await self._request(
            "POST", f"/api/v1/ads/approvals/{approval_id}/decide",
            json={"decision": decision},
        )
        return resp.json()

    # ------------------------------------------------------------------ spend

    async def today_spend(self) -> TodaySpend:
        resp = await self._request("GET", "/api/v1/spend/today")
        return TodaySpend.model_validate(resp.json())

    # ------------------------------------------------------------------ connect

    async def connect_ayrshare(self) -> AyrshareConnectResponse:
        resp = await self._request("POST", "/api/v1/connect/ayrshare")
        return AyrshareConnectResponse.model_validate(resp.json())

    async def ayrshare_status(self) -> AyrshareConnectStatus:
        resp = await self._request("GET", "/api/v1/connect/ayrshare/status")
        return AyrshareConnectStatus.model_validate(resp.json())

    # ------------------------------------------------------------------ tokens

    async def list_tokens(self) -> list[PersonalAccessToken]:
        resp = await self._request("GET", "/api/v1/tokens")
        return [PersonalAccessToken.model_validate(r) for r in resp.json()]

    async def create_token(
        self,
        *,
        name: str,
        expires_in_days: int | None = None,
    ) -> tuple[PersonalAccessToken, str]:
        body: dict[str, Any] = {"name": name}
        if expires_in_days is not None:
            body["expires_in_days"] = expires_in_days
        resp = await self._request("POST", "/api/v1/tokens", json=body)
        data = resp.json()
        return PersonalAccessToken.model_validate(data["info"]), data["token"]

    async def revoke_token(self, token_id: UUID | str) -> None:
        await self._request("DELETE", f"/api/v1/tokens/{token_id}")
