from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID, uuid4

import pytest

from autocontent.models import SpendEntry
from autocontent.services.spend_context import SpendContext


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
    )
    return ctx, rec


@pytest.fixture(autouse=True)
def _stub_openai_key(monkeypatch):
    """Provide a non-empty key so the AsyncOpenAI constructor doesn't blow up."""
    from autocontent.config import settings

    monkeypatch.setattr(settings, "openai_api_key", "sk-test")
    yield
