from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from marketer.repos.creative_library import cursor_encode, cursor_decode
from marketer.models.production import readiness
from backend.routes import companyos
from backend.routes.oauth import OAuthProblem, oauth_problem_handler


@pytest.mark.parametrize(
    "value",
    [
        None,
        [],
        123,
        "text",
        {},
        {
            "binding": "x",
            "kind": "ad",
            "id": 123,
            "asOf": "2026-01-01T00:00:00+00:00",
            "created": "2026-01-01T00:00:00+00:00",
        },
    ],
)
def test_malformed_cursors_are_validation_errors(value):
    with pytest.raises(ValueError):
        cursor_decode(cursor_encode(value), "x")


def test_blank_artifact_and_unverified_input_cannot_be_approved():
    source = {"item": {"status": "done"}, "has_output": False}
    state = {
        "brief": {
            "objective": "Goal",
            "audience": "People",
            "owner": "Ada",
            "deliverable": "Video",
            "inputs": [{"label": "Logo", "status": "available", "evidence": ""}],
        }
    }
    issues = readiness(source, state)
    assert "The source has no completed creative output" in issues
    assert "Input needs verification: Logo" in issues


@pytest.mark.parametrize(
    "case,status",
    [
        ("valid", 200),
        ("scope", 403),
        ("client", 401),
        ("suspended", 401),
        ("resource", 401),
        ("missing-user", 401),
    ],
)
def test_oauth_library_reader_boundary(monkeypatch, case, status):
    token = SimpleNamespace(scopes=[] if case == "scope" else ["content:read"])
    grant = SimpleNamespace(
        user_id="owner",
        client_id="client",
        resource="https://wrong.test" if case == "resource" else "",
    )
    monkeypatch.setattr(companyos, "_bearer_grant", AsyncMock(return_value=(token, grant)))
    monkeypatch.setattr(
        companyos.oauth_repo,
        "get_client",
        AsyncMock(return_value=SimpleNamespace(is_active=case != "client")),
    )
    monkeypatch.setattr(
        companyos.users_repo,
        "get",
        AsyncMock(
            return_value=None
            if case == "missing-user"
            else SimpleNamespace(
                suspended_at=datetime.now(timezone.utc) if case == "suspended" else None
            )
        ),
    )
    lookup = AsyncMock(return_value={"items": [], "nextCursor": None, "asOf": "now"})
    monkeypatch.setattr(companyos.creative_library, "list_items", lookup)
    app = FastAPI()
    app.add_exception_handler(OAuthProblem, oauth_problem_handler)
    app.include_router(companyos.router)
    response = TestClient(app).get("/library")
    assert response.status_code == status
    if status == 200:
        assert lookup.call_args.args[0] == "owner"
        assert response.headers["cache-control"] == "no-store"
    else:
        lookup.assert_not_called()


def test_unauthenticated_request_cannot_read_library():
    app = FastAPI()
    app.add_exception_handler(OAuthProblem, oauth_problem_handler)
    app.include_router(companyos.router)
    assert TestClient(app).get("/library").status_code == 401


def test_preview_cannot_read_outside_artifact_root(tmp_path, monkeypatch):
    from marketer.services import creative_preview

    root = tmp_path / "artifacts"
    root.mkdir()
    private = tmp_path / "private.jpg"
    private.write_bytes(b"secret")
    (root / "symlink.jpg").symlink_to(private)
    monkeypatch.setattr(creative_preview.settings, "artifacts_dir", str(root))
    assert creative_preview.local_bytes(str(private)) is None
    assert creative_preview.local_bytes(str(root / "symlink.jpg")) is None
