"""GenAI spans around every backend model call (docs/observability/braintrust.md).

Each call emits one span with ``gen_ai.request.model``, the provider, the
tenant, cost and (for text models) token usage. Prompt and completion text is
present in ``redacted`` mode, masked, and absent in ``metadata`` mode. Spans
are read as they would leave the process: through the masking processor.
"""
from __future__ import annotations

import json
import wave
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from marketer.observability import context as obs_context
from tests.otel_helpers import all_text, masked_memory

TENANT = "user_test"  # fake_spend's tenant


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


def _only(exp, prefix=""):
    spans = [s for s in exp.get_finished_spans() if s.name.startswith(prefix)]
    assert len(spans) == 1, [s.name for s in exp.get_finished_spans()]
    return spans[0]


# ---------------------------------------------------------------- Agents SDK runs


async def test_run_metered_span(monkeypatch, fake_spend):
    from marketer.agents import metered

    async def run(agent, input):
        usage = SimpleNamespace(input_tokens=100, output_tokens=20, total_tokens=120)
        return SimpleNamespace(context_wrapper=SimpleNamespace(usage=usage), final_output="Three hooks for jane@example.com")

    monkeypatch.setattr(metered.Runner, "run", staticmethod(run))
    spend, _ = fake_spend
    agent = SimpleNamespace(model="gpt-5.4-mini", name="Scriptwriter", instructions="Write hooks.")
    with masked_memory() as exp:
        await metered.run_metered(agent, "idea: pasta", spend=spend)
        span = _only(exp, "chat")
    a = span.attributes
    assert a["gen_ai.request.model"] == "gpt-5.4-mini" and a["gen_ai.provider.name"] == "openai"
    assert a["gen_ai.usage.input_tokens"] == 100 and a["gen_ai.usage.output_tokens"] == 20
    assert a["tenant_id"] == TENANT and a["gen_ai.agent.name"] == "Scriptwriter"
    assert a["marketer.cost_usd"] > 0
    assert json.loads(a["gen_ai.prompt_json"]) == [{"role": "system", "content": "Write hooks."}, {"role": "user", "content": "idea: pasta"}]
    assert "jane@example.com" not in a["gen_ai.completion_json"]


async def test_run_metered_metadata_mode(monkeypatch, fake_spend):
    from marketer.agents import metered
    from marketer.config import settings

    monkeypatch.setattr(settings, "braintrust_content", "metadata")

    async def run(agent, input):
        usage = SimpleNamespace(input_tokens=1, output_tokens=1, total_tokens=2)
        return SimpleNamespace(context_wrapper=SimpleNamespace(usage=usage), final_output="secret plan")

    monkeypatch.setattr(metered.Runner, "run", staticmethod(run))
    spend, _ = fake_spend
    with masked_memory() as exp:
        await metered.run_metered(SimpleNamespace(model="gpt-5.4-mini"), "the prompt", spend=spend)
        span = _only(exp, "chat")
    assert "gen_ai.prompt_json" not in span.attributes and "gen_ai.completion_json" not in span.attributes
    assert "the prompt" not in all_text([span]) and "secret plan" not in all_text([span])
    assert span.attributes["gen_ai.usage.input_tokens"] == 1


async def test_failed_model_call_records_error(monkeypatch, fake_spend):
    from marketer.agents import metered

    async def run(agent, input):
        raise RuntimeError("upstream said no")

    monkeypatch.setattr(metered.Runner, "run", staticmethod(run))
    spend, _ = fake_spend
    with masked_memory() as exp:
        with pytest.raises(RuntimeError):
            await metered.run_metered(SimpleNamespace(model="gpt-5.4-mini"), "x", spend=spend)
        span = _only(exp, "chat")
    assert span.status.status_code.name == "ERROR"


# ---------------------------------------------------------------- articles


async def test_article_llm_span(monkeypatch, fake_spend):
    from marketer.articles import llm

    class Completions:
        async def create(self, **kw):
            usage = SimpleNamespace(prompt_tokens=40, completion_tokens=8)
            msg = SimpleNamespace(content='{"topic": "pasta"}')
            return SimpleNamespace(usage=usage, model="gpt-x", choices=[SimpleNamespace(message=msg)])

    monkeypatch.setattr(llm, "_oai", lambda: SimpleNamespace(chat=SimpleNamespace(completions=Completions())))
    spend, rec = fake_spend
    with masked_memory() as exp:
        out = await llm._json_call(model="gpt-5.4-mini", system="sys", user="write about pasta", temperature=0.2, spend=spend)
        span = _only(exp, "chat")
    assert out == {"topic": "pasta"}
    a = span.attributes
    assert a["gen_ai.usage.input_tokens"] == 40 and a["gen_ai.request.temperature"] == 0.2
    assert json.loads(a["gen_ai.completion_json"])[0]["content"] == '{"topic": "pasta"}'
    assert len(rec.entries) == 1  # metering unchanged


# ---------------------------------------------------------------- decisions


async def test_decision_span_and_fallback_score(monkeypatch, fake_spend):
    from marketer.decisions import questions as q
    from marketer.repos import decision_log as decision_log_repo
    from marketer.repos import feature_flags as flags_repo
    from marketer.services import decisions as svc

    monkeypatch.setenv("OPENROUTER_API_KEY", "or-test-key")

    async def no_flags():
        return []

    async def insert(**kw):
        return None

    monkeypatch.setattr(flags_repo, "list_all", no_flags)
    monkeypatch.setattr(decision_log_repo, "insert", insert)
    qs = {"filler": q.YesNo("Does it open with filler?")}

    def client(status, body):
        async def handle(request):
            return httpx.Response(status, json=body)

        return svc.DecisionClient(key="or-test-key", transport=httpx.MockTransport(handle))

    ok = {"answers": {"filler": {"type": "noul", "noul": 0.2}}, "model": q.D1_MODEL, "usage": {"cost": 0.00001, "input_tokens": 30, "output_tokens": 2}}
    spend, _ = fake_spend
    with masked_memory() as exp:
        d1 = await svc.decide(q.Point.HOOK_SCORE, {"hook": "call +1 415 555 0134"}, qs, user_id=TENANT, spend=spend, client=client(200, ok))
        d2 = await svc.decide(q.Point.HOOK_SCORE, {"hook": "x"}, qs, user_id=TENANT, spend=spend, client=client(500, {}))
        spans = [s for s in exp.get_finished_spans() if s.name.startswith("decision.")]
    assert d1.ok and not d2.ok
    good, bad = spans
    assert good.name == "decision.hook_score"
    assert good.attributes["braintrust.scores.decision_fallback"] == 0.0
    assert bad.attributes["braintrust.scores.decision_fallback"] == 1.0
    assert bad.attributes["marketer.decision.error"] == "http"
    assert good.attributes["gen_ai.usage.total_tokens"] == 32
    assert "555 0134" not in good.attributes["gen_ai.prompt_json"]


# ---------------------------------------------------------------- media


def _silent_wav(path: Path, seconds: float = 0.5) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x00\x00" * int(24000 * seconds))


async def test_image_span_has_prompt_never_the_image(monkeypatch, fake_spend, tmp_path):
    import base64

    from marketer.services import openai_images

    b64 = base64.b64encode(b"\x89PNG fake").decode()

    async def call_api(prompt, **kw):
        return SimpleNamespace(data=[SimpleNamespace(b64_json=b64)])

    monkeypatch.setattr(openai_images, "_call_api", call_api)
    spend, _ = fake_spend
    with masked_memory() as exp:
        await openai_images.generate_keyframe("a bowl of pasta", tmp_path / "k.png", spend=spend)
        span = _only(exp, "gen_ai.image")
    a = span.attributes
    assert a["gen_ai.request.model"] == "gpt-image-1" and a["gen_ai.output.type"] == "image"
    assert a["marketer.cost_usd"] > 0 and a["tenant_id"] == TENANT
    assert b64 not in all_text([span])


async def test_tts_span(monkeypatch, fake_spend, tmp_path):
    from marketer.services import openai_tts

    async def call_api(out_path, kwargs):
        _silent_wav(out_path)

    monkeypatch.setattr(openai_tts, "_call_api", call_api)
    spend, _ = fake_spend
    with masked_memory() as exp:
        await openai_tts.synthesize("Hello there", tmp_path / "vo.wav", spend=spend)
        span = _only(exp, "gen_ai.speech")
    assert span.attributes["gen_ai.output.type"] == "speech"
    assert "Hello there" in span.attributes["gen_ai.prompt_json"]


async def test_whisper_span(monkeypatch, fake_spend, tmp_path):
    from marketer.services import openai_whisper

    audio = tmp_path / "a.wav"
    _silent_wav(audio)

    async def call_api(path):
        return SimpleNamespace(words=[{"word": "hello", "start": 0.0, "end": 0.2}])

    monkeypatch.setattr(openai_whisper, "_call_api", call_api)
    spend, _ = fake_spend
    with masked_memory() as exp:
        await openai_whisper.transcribe_word_level(audio, spend=spend)
        span = _only(exp, "gen_ai.transcription")
    assert span.attributes["marketer.transcript.words"] == 1


async def test_elevenlabs_and_music_spans(monkeypatch, fake_spend, tmp_path):
    from marketer.config import settings
    from marketer.services import elevenlabs_tts, music_gen

    monkeypatch.setattr(settings, "elevenlabs_api_key", "el-test")

    async def tts_api(text, voice):
        return b"\x00\x00" * 2400

    async def music_api(prompt, length_ms):
        return b"ID3 fake"

    monkeypatch.setattr(elevenlabs_tts, "_call_api", tts_api)
    monkeypatch.setattr(music_gen, "_call_api", music_api)
    spend, _ = fake_spend
    with masked_memory() as exp:
        await elevenlabs_tts.synthesize("Hi", tmp_path / "e.wav", voice_id="v1", spend=spend)
        await music_gen.compose(mood="upbeat", duration_sec=10, out_path=tmp_path / "m.mp3", spend=spend)
        names = sorted(s.name for s in exp.get_finished_spans())
    assert names[0].startswith("gen_ai.music") and names[1].startswith("gen_ai.speech")


async def test_grok_span(monkeypatch, fake_spend, tmp_path):
    from marketer.services import grok_imagine

    key = tmp_path / "k.png"
    key.write_bytes(b"\x89PNG fake")

    async def submit(client, body):
        return "req1"

    async def poll(client, request_id):
        return {"video": {"url": "https://example.test/v.mp4", "duration": 5}}

    async def download(client, url, out_path):
        out_path.write_bytes(b"mp4")

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(grok_imagine, "_submit", submit)
    monkeypatch.setattr(grok_imagine, "_poll", poll)
    monkeypatch.setattr(grok_imagine, "_download", download)
    monkeypatch.setattr(grok_imagine, "_client", lambda: Client())
    spend, _ = fake_spend
    with masked_memory() as exp:
        await grok_imagine.animate(key, "slow push in", tmp_path / "v.mp4", spend=spend)
        span = _only(exp, "gen_ai.video")
    assert "data:image" not in all_text([span])
    assert "slow push in" in span.attributes["gen_ai.prompt_json"]
