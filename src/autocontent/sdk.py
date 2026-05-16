"""Thin async client around the autocontent FastAPI backend.

Auth: pass a personal access token (``act_...``) explicitly via ``token``
or set ``AUTOCONTENT_API_TOKEN`` in the environment. The base URL comes
from ``base_url`` or ``AUTOCONTENT_API_BASE_URL``.

Every method returns pydantic models from ``autocontent.models``.
"""
from __future__ import annotations

import os
from typing import Any
from uuid import UUID

import httpx

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

ENV_BASE_URL = "AUTOCONTENT_API_BASE_URL"
ENV_TOKEN = "AUTOCONTENT_API_TOKEN"


class AutoContentError(Exception):
    """Raised on non-2xx responses from the backend."""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(f"{status_code}: {message}")
        self.status_code = status_code
        self.message = message


def _require(value: str | None, env_var: str, ctor_arg: str) -> str:
    if not value:
        raise RuntimeError(
            f"missing {ctor_arg} (set {env_var} or pass {ctor_arg}= to AutoContentClient)"
        )
    return value


class AutoContentClient:
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

    async def __aenter__(self) -> "AutoContentClient":
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
            raise AutoContentError(resp.status_code, str(detail))
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
