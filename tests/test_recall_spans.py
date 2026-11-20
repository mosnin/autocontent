"""Recall content never reaches a span (docs/observability/braintrust.md, rule 5).

Recall spans carry the operation, scope kind, status, a result count and
timing. Never the query, the stored content, the memories or the namespace,
in either export path (generic OTLP and Braintrust), even inside a model
span, and even when the call fails.
"""
from __future__ import annotations

import pytest
from opentelemetry import trace

from marketer.observability import context as obs_context
from marketer.observability.masking import RECALL_ALLOWED
from marketer.recall.namespace import scope
from marketer.services.supermemory import Breaker, SupermemoryClient, SupermemoryError
from tests.otel_helpers import all_text, masked_memory
from tests.supermemory_fake import TEST_SECRET, FakeSupermemory, fake_config

ALICE = scope("personal", "user_t", "usr_alice", TEST_SECRET)
MEMORY = "Alice lives at 12 Juniper Lane and her daughter is called Mira"
QUERY = "where does Alice live"


@pytest.fixture(autouse=True)
def _redacted(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "braintrust_content", "redacted")
    obs_context.forget_cache()
    obs_context.remember("user_t", "redacted")
    yield
    obs_context.forget_cache()


def _client(fake):
    return SupermemoryClient(fake_config(), transport=fake.transport(), breaker=Breaker())


@pytest.mark.parametrize("ai_only", [False, True])
async def test_recall_spans_carry_counts_never_content(ai_only):
    fake = FakeSupermemory()
    fake.seed(ALICE.namespace, MEMORY)
    with masked_memory(ai_only=ai_only) as exp:
        tracer = trace.get_tracer("test")
        with tracer.start_as_current_span("chat m", attributes={"gen_ai.operation.name": "chat", "tenant_id": "user_t"}):
            await _client(fake).add(ALICE, content=MEMORY, doc_id="conv_1")
            hits = await _client(fake).search(ALICE, QUERY)
        spans = exp.get_finished_spans()
    assert hits and MEMORY.split()[0] in hits[0].text
    recall = [s for s in spans if s.name.startswith("recall.")]
    assert {s.name for s in recall} == {"recall.post_document", "recall.post_search"}
    for s in recall:
        assert set(s.attributes) <= RECALL_ALLOWED | {"marketer.content_mode"}
        assert s.attributes["marketer.recall.scope"] == "personal"
    search = next(s for s in recall if s.name == "recall.post_search")
    assert search.attributes["marketer.recall.count"] >= 1
    text = all_text(spans)
    for leaked in ("Juniper", "Mira", QUERY, ALICE.namespace):
        assert leaked not in text


async def test_failed_recall_call_carries_no_detail():
    fake = FakeSupermemory()
    fake.fail_next(400)
    with masked_memory() as exp:
        with pytest.raises(SupermemoryError):
            await _client(fake).add(ALICE, content=MEMORY, doc_id="conv_2")
        (span,) = [s for s in exp.get_finished_spans() if s.name.startswith("recall.")]
    assert span.attributes["marketer.recall.error"] == "rejected"
    assert span.status.description is None
    assert "Juniper" not in all_text([span])
