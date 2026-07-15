"""CLI smoke tests with the SDK swapped for a fake."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import pytest

from marketer import cli as cli_mod
from marketer.models import (
    AyrshareConnectResponse,
    Job,
    JobStatus,
    Niche,
    PersonalAccessToken,
    PostingWindow,
    TodaySpend,
)


class FakeClient:
    def __init__(self, *args, **kwargs) -> None:
        self.calls: list[tuple] = []
        FakeClient.last_instance = self

    async def __aenter__(self) -> "FakeClient":
        return self

    async def __aexit__(self, *exc) -> None:
        return None

    async def list_niches(self):
        self.calls.append(("list_niches",))
        return [_niche(title="alpha"), _niche(title="beta")]

    async def get_niche(self, niche_id):
        self.calls.append(("get_niche", niche_id))
        return _niche(title="alpha", niche_id=UUID(str(niche_id)))

    async def create_niche(self, payload):
        self.calls.append(("create_niche", payload))
        return _niche(title=payload.title)

    async def archive_niche(self, niche_id):
        self.calls.append(("archive_niche", niche_id))

    async def list_jobs(self, *, status=None, limit=50):
        self.calls.append(("list_jobs", status, limit))
        return [_job()]

    async def get_job(self, job_id):
        self.calls.append(("get_job", job_id))
        return _job(job_id=UUID(str(job_id)))

    async def enqueue_job(self, *, niche_id, platform):
        self.calls.append(("enqueue_job", niche_id, platform))
        return _job()

    async def retry_job(self, job_id):
        self.calls.append(("retry_job", job_id))
        return _job(job_id=UUID(str(job_id)))

    async def today_spend(self):
        self.calls.append(("today_spend",))
        return TodaySpend(by_niche={"nid1": Decimal("1.20")}, total_usd=Decimal("1.20"))

    async def connect_ayrshare(self):
        self.calls.append(("connect_ayrshare",))
        return AyrshareConnectResponse(
            profile_key="pk-1", login_url="https://app.ayrshare.com/connect/xyz"
        )

    async def list_tokens(self):
        self.calls.append(("list_tokens",))
        return [_pat("ci")]

    async def create_token(self, *, name, expires_in_days=None):
        self.calls.append(("create_token", name, expires_in_days))
        return _pat(name), "mkt_freshplaintext1234567"

    async def revoke_token(self, token_id):
        self.calls.append(("revoke_token", token_id))


FakeClient.last_instance = None


def _niche(*, title: str, niche_id: UUID | None = None) -> Niche:
    return Niche(
        id=niche_id or uuid4(),
        user_id="user_abc",
        title=title,
        description="d",
        target_audience="ta",
        hashtags=[],
        visual_style="vs",
        voice="onyx",
        target_duration_sec=60,
        scene_count=6,
        posting_windows=[PostingWindow(hour=9, minute=0, tz="UTC")],
        platforms=["tiktok"],
        daily_spend_cap_usd=Decimal("5.00"),
    )


def _job(*, job_id: UUID | None = None) -> Job:
    return Job(
        id=job_id or uuid4(),
        user_id="user_abc",
        niche_id=uuid4(),
        platform="tiktok",
        status=JobStatus.queued,
        created_at=datetime.now(timezone.utc),
    )


def _pat(name: str) -> PersonalAccessToken:
    return PersonalAccessToken(
        id=uuid4(),
        user_id="user_abc",
        name=name,
        prefix="mkt_fres",
        created_at=datetime.now(timezone.utc),
    )


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("MARKETER_API_BASE_URL", "https://api.test.local")
    monkeypatch.setenv("MARKETER_API_TOKEN", "mkt_testtoken12345")
    monkeypatch.setattr(cli_mod, "MarketerClient", FakeClient)
    FakeClient.last_instance = None


def test_missing_env_exits_2(monkeypatch):
    monkeypatch.delenv("MARKETER_API_BASE_URL", raising=False)
    monkeypatch.delenv("MARKETER_API_TOKEN", raising=False)
    rc = cli_mod.main(["niches", "list"])
    assert rc == 2


def test_niches_list_table_format(capsys):
    rc = cli_mod.main(["niches", "list"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "title" in out
    assert "alpha" in out
    assert "beta" in out


def test_niches_list_json_format(capsys):
    rc = cli_mod.main(["niches", "list", "--json"])
    out = capsys.readouterr().out
    assert rc == 0
    parsed = json.loads(out)
    assert isinstance(parsed, list)
    assert parsed[0]["title"] == "alpha"


def test_niches_create_sends_payload(capsys):
    rc = cli_mod.main([
        "niches", "create",
        "--title", "macro duck",
        "--description", "explains the fed",
        "--target-audience", "ta",
        "--visual-style", "claymation",
        "--voice", "onyx",
        "--target-duration-sec", "60",
        "--scene-count", "6",
        "--platforms", "tiktok,reels",
        "--daily-spend-cap-usd", "5.00",
        "--posting-hour", "9",
        "--posting-minute", "0",
        "--tz", "UTC",
    ])
    out = capsys.readouterr()
    assert rc == 0
    assert "created niche" in out.err
    parsed = json.loads(out.out)
    assert parsed["title"] == "macro duck"
    assert ("create_niche", FakeClient.last_instance.calls[0][1]) == FakeClient.last_instance.calls[0]
    payload = FakeClient.last_instance.calls[0][1]
    assert payload.platforms == ["tiktok", "reels"]


def test_jobs_enqueue_confirmation_on_stderr(capsys):
    nid = str(uuid4())
    rc = cli_mod.main(["jobs", "enqueue", "--niche", nid, "--platform", "tiktok"])
    captured = capsys.readouterr()
    assert rc == 0
    assert "enqueued job" in captured.err
    parsed = json.loads(captured.out)
    assert parsed["platform"] == "tiktok"


def test_jobs_list_with_status_filter(capsys):
    rc = cli_mod.main(["jobs", "list", "--status", "failed", "--limit", "5", "--json"])
    out = capsys.readouterr().out
    assert rc == 0
    parsed = json.loads(out)
    assert isinstance(parsed, list)
    # Verify the SDK received our filter.
    call = FakeClient.last_instance.calls[0]
    assert call == ("list_jobs", "failed", 5)


def test_spend_today_human_readable(capsys):
    rc = cli_mod.main(["spend", "today"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "total_usd" in out
    assert "1.20" in out


def test_spend_today_json(capsys):
    assert cli_mod.main(["spend", "today", "--json"]) == 0
    parsed = json.loads(capsys.readouterr().out)
    assert parsed["total_usd"] == "1.20"


def test_connect_ayrshare_prints_url(capsys):
    rc = cli_mod.main(["connect", "ayrshare"])
    out = capsys.readouterr()
    assert rc == 0
    assert "https://app.ayrshare.com/connect/xyz" in out.out


def test_tokens_create_prints_plaintext_once(capsys):
    rc = cli_mod.main(["tokens", "create", "--name", "ci", "--expires-in-days", "30"])
    captured = capsys.readouterr()
    assert rc == 0
    assert captured.out.strip() == "mkt_freshplaintext1234567"
    assert "store it now" in captured.err
    assert FakeClient.last_instance.calls[0] == ("create_token", "ci", 30)


def test_tokens_list(capsys):
    rc = cli_mod.main(["tokens", "list"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "mkt_fres" in out


def test_tokens_revoke(capsys):
    tid = str(uuid4())
    rc = cli_mod.main(["tokens", "revoke", tid])
    err = capsys.readouterr().err
    assert rc == 0
    assert "revoked" in err
