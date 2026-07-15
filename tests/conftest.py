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
