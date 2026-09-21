from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest

from backend import native_connector as native


def test_loopback_registration_rejects_remote_and_write_authority():
    base = {"redirect_uris": ["http://127.0.0.1:32199/callback"]}
    assert native.registration_metadata(base)[1] == base["redirect_uris"]
    for callback in [
        "https://attacker.example/cb",
        "http://127.0.0.1/cb",
        "http://127.0.0.1:32199/cb#x",
    ]:
        with pytest.raises(ValueError):
            native.registration_metadata({"redirect_uris": [callback]})
    for override in [
        {"scope": "content:write"},
        {"token_endpoint_auth_method": "client_secret_basic"},
        {"grant_types": ["password"]},
    ]:
        with pytest.raises(ValueError):
            native.registration_metadata({**base, **override})


@pytest.fixture
def identity(monkeypatch):
    token = native.oauth_repo.Token(
        id=uuid4(),
        grant_id=uuid4(),
        kind="access",
        token_hash="fixture",
        scopes=["openid", "content:read"],
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    grant = native.oauth_repo.Grant(
        id=token.grant_id,
        user_id="actual-owner",
        client_id="client",
        resource=native.protocol.resource_identifier(),
    )
    client = SimpleNamespace(is_active=True)
    user = SimpleNamespace(id="actual-owner", email="owner@example.test", suspended_at=None)

    async def bearer(_request):
        return token, grant

    async def get_client(_id):
        return client

    async def get_user(_id):
        return user

    monkeypatch.setattr(native.oauth, "_bearer_grant", bearer)
    monkeypatch.setattr(native.oauth_repo, "get_client", get_client)
    monkeypatch.setattr(native.users_repo, "get", get_user)
    return token, grant, client, user


@pytest.mark.asyncio
async def test_native_rejects_wrong_resource_disabled_client_and_suspended_user(identity):
    token, grant, client, user = identity
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=native.create_app()), base_url="https://test"
    ) as http:
        body = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
        grant.resource = "https://different.example/api"
        assert (await http.post("/api/mcp", json=body)).status_code == 401
        grant.resource = native.protocol.resource_identifier()
        client.is_active = False
        assert (await http.post("/api/mcp", json=body)).status_code == 401
        client.is_active = True
        user.suspended_at = datetime.now(timezone.utc)
        assert (await http.post("/api/mcp", json=body)).status_code == 401


@pytest.mark.asyncio
async def test_native_uses_grant_owner_and_filters_tools(identity, monkeypatch):
    token, _grant, _client, _user = identity
    calls = []

    class Pool:
        async def fetch(self, query, user_id):
            calls.append((query, user_id))
            return []

    async def pool():
        return Pool()

    monkeypatch.setattr(native, "get_pool", pool)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=native.create_app()), base_url="https://test"
    ) as http:
        response = await http.post(
            "/api/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "marketer_list_articles", "arguments": {}},
            },
        )
        assert response.status_code == 200
        assert calls[0][1] == "actual-owner"
        assert "WHERE user_id=$1" in calls[0][0]
        token.scopes = ["openid"]
        response = await http.post(
            "/api/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
        )
        assert [t["name"] for t in response.json()["result"]["tools"]] == ["marketer_account"]
        response = await http.post(
            "/api/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "marketer_list_articles"},
            },
        )
        assert response.status_code == 403
        response = await http.post(
            "/api/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"}
        )
        assert response.status_code == 202
