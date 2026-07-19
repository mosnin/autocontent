from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID, uuid4

import pytest

from marketer.models import SpendEntry
from marketer.services.spend_context import SpendContext


@pytest.fixture(autouse=True)
def _reset_db_pool():
    """Drop the cached asyncpg pool before every test.

    pytest-asyncio gives each test its own event loop. A pool created in one
    test is bound to that (now-closed) loop, so any later test that reused the
    cached ``db._pool`` failed with "Event loop is closed". Clearing the module
    global before each test forces a fresh, correctly-bound pool per test and
    keeps unit tests hermetic regardless of run order. We don't await close():
    the old loop is already gone, and the orphaned pool is garbage-collected.
    """
    from marketer import db

    db._pool = None
    yield
    db._pool = None


@dataclass
class FakeRecorder:
    entries: list[SpendEntry] = field(default_factory=list)

    async def __call__(self, entry: SpendEntry) -> None:
        self.entries.append(entry)


@pytest.fixture
def fake_spend() -> tuple[SpendContext, FakeRecorder]:
    rec = FakeRecorder()
    ctx = SpendContext(
        user_id="user_test",
        niche_id=UUID("00000000-0000-0000-0000-000000000001"),
        job_id=uuid4(),
        record=rec,
        cap_usd=None,
    )
    return ctx, rec


@pytest.fixture(autouse=True)
def _stub_openai_key(monkeypatch):
    """Provide a non-empty key so the AsyncOpenAI constructor doesn't blow up."""
    from marketer.config import settings

    monkeypatch.setattr(settings, "openai_api_key", "sk-test")
    yield


@pytest.fixture
def passing_render_qa(monkeypatch):
    """Stub the deterministic render gate with an always-green report.

    Pipeline tests stub ffmpeg/providers with sentinel files that ffprobe
    could never parse; this keeps them exercising pipeline control flow
    rather than the gate itself (covered in test_video_qa.py).
    """
    from marketer.services import video_qa

    def fake_check_render(
        final_path, *, voiceover_path, target_duration_sec,
        max_upload_bytes=video_qa.MAX_UPLOAD_BYTES,
    ):
        return video_qa.RenderReport(
            passed=True,
            issues=[],
            final_path=str(final_path),
            duration_sec=float(target_duration_sec or 10),
            size_bytes=1024,
        )

    monkeypatch.setattr(video_qa, "check_render", fake_check_render)
    return fake_check_render
