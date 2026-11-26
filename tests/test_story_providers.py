"""DefaultProviders.chat_json: OpenRouter when configured, a GenAI span with
tokens and cost, metered through the story meter; plus JSON parsing and the
stage spans of a run."""
from __future__ import annotations

import json
from decimal import Decimal
from types import SimpleNamespace

import pytest

from marketer.observability import context as obs_context
from marketer.story import pipeline
from marketer.story.meter import StoryMeter
from marketer.story.models import StoryStatus
from marketer.story.providers import DefaultProviders, parse_json_object
from marketer.story.store import InMemoryStoryStore
from tests.otel_helpers import masked_memory
from tests.story_fakes import FakeProviders, Ledger, new_story, spend_for


@pytest.fixture(autouse=True)
def _redacted(monkeypatch):
    from marketer.config import settings
    from marketer.repos import observability as repo

    monkeypatch.setattr(settings, "braintrust_content", "redacted")

    async def get_setting(tenant_id):
        return repo.Setting("redacted", None)

    monkeypatch.setattr(repo, "get_setting", get_setting)
    obs_context.forget_cache()
    yield
    obs_context.forget_cache()


def _fake_client(content: str):
    class Completions:
        kwargs: dict = {}

        async def create(self, **kw):
            Completions.kwargs = kw
            usage = SimpleNamespace(prompt_tokens=1000, completion_tokens=500)
            return SimpleNamespace(usage=usage, model="anthropic/claude-sonnet-4.5-2026",
                                   choices=[SimpleNamespace(message=SimpleNamespace(content=content))])

    return SimpleNamespace(chat=SimpleNamespace(completions=Completions())), Completions


async def test_chat_json_on_openrouter_is_spanned_and_metered(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "openrouter_api_key", "or-test")
    prov = DefaultProviders()
    client, completions = _fake_client('```json\n{"scenes": [{"heading": "INT", "script": "x"}]}\n```')
    prov._client = client
    store = InMemoryStoryStore()
    story = await store.create(new_story())
    ledger = Ledger()
    meter = StoryMeter(store=store, story_id=story.id, user_id=story.user_id, base=spend_for(story.user_id, ledger))
    with masked_memory() as exp:
        async with meter.unit("scenes:r0", "scenes"):
            out = await prov.chat_json(system="sys", user="usr", spend=meter.spend, stage="scenes")
        spans = [s for s in exp.get_finished_spans() if s.name.startswith("chat ")]
    assert out.data["scenes"][0]["heading"] == "INT"
    assert completions.kwargs["model"] == "anthropic/claude-sonnet-4.5"
    assert completions.kwargs["response_format"] == {"type": "json_object"}
    a = spans[0].attributes
    assert a["gen_ai.provider.name"] == "openrouter" and a["gen_ai.usage.input_tokens"] == 1000
    assert a["marketer.story.stage"] == "scenes"
    # $3/M in + $15/M out = 0.003 + 0.0075
    assert ledger.total == Decimal("0.010500")
    charges = await store.charges(story.id)
    assert [c.cost_micros for c in charges] == [10_500]
    assert charges[0].idempotency_key == f"story:{story.id}:scenes:r0#0"
    assert json.loads(a["gen_ai.completion_json"])


async def test_chat_json_falls_back_to_openai_without_openrouter(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "openrouter_api_key", "")
    assert DefaultProviders()._text_route() == ("openai", settings.agent_model)


def test_parse_json_object():
    assert parse_json_object('noise {"a": 1} tail') == {"a": 1}
    with pytest.raises(ValueError):
        parse_json_object("no json here")
    with pytest.raises(ValueError):
        parse_json_object("[1, 2]")


async def test_run_emits_pipeline_spans_with_tenant(tmp_path):
    store, prov, ledger = InMemoryStoryStore(), FakeProviders(), Ledger()
    story = await store.create(new_story())
    with masked_memory(ai_only=True) as exp:
        out = await pipeline.run_stage(story.id, user_id=story.user_id, stage="script", store=store, providers=prov,
                                       spend=spend_for(story.user_id, ledger), root=tmp_path)
        names = [s.name for s in exp.get_finished_spans()]
        root = next(s for s in exp.get_finished_spans() if s.name == "pipeline.story.run.script")
    assert out.status == StoryStatus.script_ready
    assert {"pipeline.story.develop", "pipeline.story.scenes"} <= set(names)
    assert root.attributes["tenant_id"] == story.user_id and root.attributes["agent"] == "story_video"
