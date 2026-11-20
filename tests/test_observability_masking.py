"""The masking function and the masking span processor
(docs/observability/braintrust.md, rules 3 to 6).

- secrets, emails, phones and cards are replaced in every string;
- credential-named attributes are dropped, token counts are kept;
- metadata mode drops prompt and output text, and exception messages;
- the workspace override forces metadata; an unknown workspace counts as metadata;
- recall spans keep only counts, timing and scope kind;
- the Braintrust side keeps only AI spans and re-parents across dropped ones;
- a span that can't be masked is dropped, never exported unmasked.
"""
from __future__ import annotations

import json

import pytest
from opentelemetry import trace

from marketer.observability import context as obs_context
from marketer.observability import masking
from marketer.observability.processor import MaskingSpanProcessor
from tests.otel_helpers import all_text, masked_memory

FAKE_SECRET = "password: not-a-real-pass-123"
FAKE_BEARER = "Bearer abcdefghijklmnopqrstuvwx"
EMAIL = "jane.doe@example.com"
PHONE = "+1 (415) 555-0134"
CARD = "4242 4242 4242 4242"


@pytest.fixture(autouse=True)
def _redacted(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "braintrust_content", "redacted")
    obs_context.forget_cache()
    yield
    obs_context.forget_cache()


# ---------------------------------------------------------------- the function


def test_mask_text_replaces_secrets_emails_phones_and_cards():
    text = f"write to {EMAIL} or call {PHONE}; card {CARD}; {FAKE_SECRET}; header {FAKE_BEARER}"
    out = masking.mask_text(text)
    for leaked in (EMAIL, PHONE, CARD, "not-a-real-pass-123", "abcdefghijklmnopqrstuvwx"):
        assert leaked not in out
    assert "[EMAIL]" in out and "[PHONE]" in out and "[REDACTED_CREDIT_CARD]" in out


def test_mask_text_keeps_ordinary_numbers():
    text = "Views rose 28% to 48,200 on 2026-11-20; order 123456789012; $3.20 of $15"
    assert masking.mask_text(text) == text


@pytest.mark.parametrize(
    "name",
    ["http.request.header.authorization", "cookie", "x-api-key", "openai.api_key", "client_secret", "db.password", "session.token", "refresh_token"],
)
def test_secret_named_attributes_are_dropped(name):
    assert masking.mask_attributes({name: "anything", "keep": "ok"}) == {"keep": "ok"}


def test_token_counts_are_not_secrets():
    attrs = {"gen_ai.usage.input_tokens": 10, "gen_ai.usage.output_tokens": 3, "gen_ai.request.max_tokens": 50, "braintrust.metrics.tokens": 13}
    assert masking.mask_attributes(attrs) == attrs


def test_metadata_mode_drops_content_keeps_the_rest():
    attrs = {
        "gen_ai.prompt_json": json.dumps([{"role": "user", "content": "hello"}]),
        "gen_ai.completion_json": "[]",
        "gen_ai.prompt.0.content": "hi",
        "braintrust.input": "x",
        "gen_ai.request.model": "m",
        "gen_ai.usage.input_tokens": 4,
        "marketer.cost_usd": 0.01,
        "braintrust.scores.decision_fallback": 1.0,
    }
    out = masking.mask_attributes(attrs, mode="metadata")
    assert out == {"gen_ai.request.model": "m", "gen_ai.usage.input_tokens": 4, "marketer.cost_usd": 0.01, "braintrust.scores.decision_fallback": 1.0}


def test_unknown_mode_is_metadata():
    assert masking.normalize_mode("full") == "metadata"
    assert masking.normalize_mode("") == "metadata"
    assert masking.normalize_mode("Redacted") == "redacted"


def test_recall_allowlist():
    attrs = {"marketer.recall.op": "post_search", "marketer.recall.count": 3, "query": "my old address", "url.full": "https://x/ns/abc/search"}
    assert masking.mask_attributes(attrs, recall=True) == {"marketer.recall.op": "post_search", "marketer.recall.count": 3}


# ---------------------------------------------------------------- the processor


def _span(name="chat m", attrs=None, *, raise_=None, event=None):
    tracer = trace.get_tracer("test")
    with tracer.start_as_current_span(name, attributes=attrs or {}, record_exception=False, set_status_on_exception=False) as span:
        if event:
            span.add_event(*event)
        if raise_ is not None:
            span.record_exception(raise_)
            span.set_status(trace.StatusCode.ERROR, str(raise_))


def test_processor_masks_attributes_events_and_status():
    with masked_memory() as exp:
        _span(
            attrs={"gen_ai.prompt_json": json.dumps([{"role": "user", "content": f"email {EMAIL}, {FAKE_SECRET}"}]), "authorization": FAKE_BEARER},
            raise_=RuntimeError(f"failed for {EMAIL}"),
            event=("note", {"text": f"call {PHONE}"}),
        )
        spans = exp.get_finished_spans()
    text = all_text(spans)
    assert EMAIL not in text and "not-a-real-pass-123" not in text and PHONE not in text
    assert "authorization" not in spans[0].attributes
    assert "[EMAIL]" in spans[0].attributes["gen_ai.prompt_json"]
    assert spans[0].attributes["marketer.content_mode"] == "redacted"


def test_global_metadata_mode(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "braintrust_content", "metadata")
    with masked_memory() as exp:
        _span(attrs={"gen_ai.prompt_json": "[]", "gen_ai.request.model": "m"}, raise_=RuntimeError("the prompt said hello"))
        (span,) = exp.get_finished_spans()
    assert "gen_ai.prompt_json" not in span.attributes
    assert span.attributes["gen_ai.request.model"] == "m"
    assert span.attributes["marketer.content_mode"] == "metadata"
    assert span.status.description is None
    (ev,) = span.events
    assert ev.attributes["exception.type"] == "RuntimeError"
    assert "exception.message" not in ev.attributes and "exception.stacktrace" not in ev.attributes


def test_workspace_override_forces_metadata():
    obs_context.remember("tenant_quiet", "metadata")
    obs_context.remember("tenant_loud", "redacted")
    with masked_memory() as exp:
        _span(attrs={"tenant_id": "tenant_quiet", "gen_ai.completion_json": "[]"})
        _span(attrs={"tenant_id": "tenant_loud", "gen_ai.completion_json": "[]"})
        quiet, loud = exp.get_finished_spans()
    assert "gen_ai.completion_json" not in quiet.attributes
    assert "gen_ai.completion_json" in loud.attributes


def test_unknown_workspace_counts_as_metadata():
    with masked_memory() as exp:
        _span(attrs={"tenant_id": "never_seen", "gen_ai.completion_json": "[]"})
        (span,) = exp.get_finished_spans()
    assert "gen_ai.completion_json" not in span.attributes


def test_identity_is_stamped_from_context_without_email():
    with masked_memory() as exp:
        with obs_context.scope(tenant_id="t1", actor_id="p1", role="marketer"):
            _span()
        (span,) = exp.get_finished_spans()
    assert span.attributes["tenant_id"] == "t1"
    assert span.attributes["actor_id"] == "p1"
    assert span.attributes["role"] == "marketer"
    assert not any("email" in k for k in span.attributes)


def test_spans_inside_recall_guard_keep_only_the_allowlist():
    with masked_memory() as exp:
        with obs_context.recall_guard():
            _span("POST", attrs={"url.full": "https://api/ns/secretns/search", "marketer.recall.count": 2}, raise_=RuntimeError("memory: I live at 1 Main St"))
        (span,) = exp.get_finished_spans()
    assert "url.full" not in span.attributes
    assert span.attributes["marketer.recall.count"] == 2
    assert "Main St" not in all_text([span])


def test_ai_only_keeps_ai_spans_and_reparents():
    tracer = trace.get_tracer("test")
    with masked_memory(ai_only=True) as exp:
        with tracer.start_as_current_span("pipeline.run_job") as root:
            with tracer.start_as_current_span("POST /api/v1/jobs"):  # not AI: dropped
                with tracer.start_as_current_span("chat gpt", attributes={"gen_ai.operation.name": "chat"}):
                    pass
            with tracer.start_as_current_span("SELECT jobs"):
                pass
        names = {s.name: s for s in exp.get_finished_spans()}
    assert set(names) == {"pipeline.run_job", "chat gpt"}
    assert names["chat gpt"].parent.span_id == root.get_span_context().span_id
    assert names["pipeline.run_job"].parent is None


def test_unmaskable_span_is_dropped(monkeypatch):
    from marketer.observability import processor as proc

    def boom(*a, **k):
        raise RuntimeError("masking broke")

    monkeypatch.setattr(proc, "masked_copy", boom)
    with masked_memory() as exp:
        _span(attrs={"gen_ai.prompt_json": "[]"})
        assert exp.get_finished_spans() == ()


def test_processor_never_raises_from_inner():
    class Broken:
        def on_start(self, *a, **k):
            raise RuntimeError

        def on_end(self, *a, **k):
            raise RuntimeError

        def shutdown(self):
            raise RuntimeError

        def force_flush(self, timeout_millis=0):
            raise RuntimeError

    from tests.otel_helpers import installed

    with installed(MaskingSpanProcessor(Broken())):
        _span()  # must not raise


def test_json_values_stay_valid_json():
    raw = json.dumps([{"role": "user", "content": f"{FAKE_SECRET}"}, {"role": "user", "content": EMAIL, "api_key": "x"}])
    out = json.loads(masking.mask_value(raw))
    assert out[0]["content"] == "[REDACTED_CREDENTIAL_ASSIGNMENT]"
    assert out[1] == {"role": "user", "content": "[EMAIL]"}
