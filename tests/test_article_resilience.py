"""Resilience tests for the article (Press) pipeline: writer-model
fallback, hero-image graceful degradation, and spend-cap failure
propagation. Mirrors the video pipeline's resilience test bar.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from marketer.articles import exa, llm
from marketer.articles import pipeline as apipe
from marketer.articles.models import (
    Article,
    ArticleMetadata,
    ArticleStatus,
    ImagePrompt,
    Outline,
    OutlineSection,
    QualityScore,
    TopicPick,
)
from marketer.repos.spend import SpendCapExceeded
from marketer.services import provider_fallback

USER_ID = "user_article_resilience"
NICHE_ID = UUID("00000000-0000-0000-0000-00000000a002")

# Captured at import time, before any fixture monkeypatches llm.write_section
# in place — needed so the fallback end-to-end test can restore the real
# implementation on top of the stub_all fixture's blanket fake.
_REAL_WRITE_SECTION = llm.write_section


def _niche():
    return SimpleNamespace(
        id=NICHE_ID,
        title="home espresso",
        description="dialing in espresso at home",
        target_audience="hobbyist baristas",
        tts_style_directions="warm, practical",
        image_quality="medium",
        daily_spend_cap_usd=Decimal("3.00"),
    )


def _outline() -> Outline:
    return Outline(
        title="Dialing In Espresso: A Practical Guide",
        sections=[
            OutlineSection(level=1, heading="Dialing In Espresso: A Practical Guide"),
            OutlineSection(level=2, heading="Grind Size Basics", notes="cover burrs"),
            OutlineSection(level=2, heading="Dose and Yield", notes="ratios"),
        ],
    )


@pytest.fixture
def stub_all(monkeypatch, tmp_path):
    """Same stubbing pattern as test_article_pipeline.py's stub_all, kept
    self-contained here so this file's fallback/degrade scenarios can
    layer their own monkeypatches on top without depending on another
    test module's fixture."""
    state: dict = {"saved": [], "statuses": [], "scored": 0}
    article_holder: dict = {}

    async def fake_niche_get(niche_id, *, user_id):
        return _niche()

    monkeypatch.setattr(apipe.niches_repo, "get", fake_niche_get)

    async def fake_brand_get(user_id):
        return state.get("brand")

    monkeypatch.setattr(apipe.brand_kit_repo, "get", fake_brand_get)

    async def fake_create(*, user_id, niche_id, topic=""):
        art = Article(
            id=uuid4(), user_id=user_id, niche_id=niche_id, topic=topic,
            created_at=datetime.now(timezone.utc),
        )
        article_holder["article"] = art
        return art

    async def fake_get(article_id, *, user_id):
        return article_holder.get("article")

    async def fake_save(article):
        state["saved"].append(article.model_copy(deep=True))
        state["statuses"].append(article.status.value)

    async def fake_recent_titles(niche_id, *, user_id, limit=25):
        return ["Old Espresso Post"]

    async def fake_candidates(user_id, *, limit=25):
        return [{"title": "Old Espresso Post", "slug": "old-espresso-post"}]

    monkeypatch.setattr(apipe.articles_repo, "create", fake_create)
    monkeypatch.setattr(apipe.articles_repo, "get", fake_get)
    monkeypatch.setattr(apipe.articles_repo, "save", fake_save)
    monkeypatch.setattr(apipe.articles_repo, "recent_titles_for_niche", fake_recent_titles)
    monkeypatch.setattr(apipe.articles_repo, "interlink_candidates", fake_candidates)

    from marketer.services.spend_context import SpendContext

    async def fake_default_context(**kwargs):
        entries = state.setdefault("spend_entries", [])

        async def _rec(entry):
            entries.append(entry)

        return SpendContext(
            user_id=kwargs["user_id"], niche_id=kwargs["niche_id"],
            job_id=None, article_id=kwargs.get("article_id"),
            record=_rec, cap_usd=None,
        )

    monkeypatch.setattr(apipe, "default_context", fake_default_context)

    async def fake_serp_pages(keyword, num_results=8):
        return []

    monkeypatch.setattr(exa, "serp_pages", fake_serp_pages)
    monkeypatch.setattr(apipe.exa, "serp_pages", fake_serp_pages)

    async def fake_pick_topic(title, desc, recent, *, spend=None):
        return TopicPick(topic="dialing in espresso", focusKeyword="dial in espresso")

    async def fake_outline(topic, keyword, research, tone, audience, *, spend=None):
        return _outline()

    async def fake_write_section(heading, notes, ctx, *, spend=None):
        kw = ctx.focusKeyword
        return f"## {heading}\n\nHow to {kw} at home, step by step."

    async def fake_score(md, kw, *, spend=None):
        state["scored"] += 1
        return QualityScore(
            overall=0.9, keywordDensity=0.01, eeatScore=0.8,
            readability=0.9, notes=["fine"],
        )

    async def fake_metadata(topic, keyword, md, tone, *, spend=None):
        return ArticleMetadata(
            title="Dial In Espresso at Home: Complete Guide",
            slug="dial-in-espresso-at-home",
            metaDescription="Learn to dial in espresso at home." + " x" * 40,
            focusKeyword=keyword,
            keywords=["espresso", "grinder"],
        )

    async def fake_schema(**kwargs):
        return '{"@context": "https://schema.org"}'

    async def fake_interlink(md, candidates, *, spend=None):
        from marketer.articles.models import InterlinkSuggestion
        return [InterlinkSuggestion(anchor="old post", targetUrl="/old-espresso-post", score=0.8)]

    async def fake_hero_prompt(title, kw, md, *, spend=None):
        return ImagePrompt(type="hero", prompt="an espresso machine", altText="dial in espresso setup")

    monkeypatch.setattr(apipe.llm, "pick_topic", fake_pick_topic)
    monkeypatch.setattr(apipe.llm, "generate_outline", fake_outline)
    monkeypatch.setattr(apipe.llm, "write_section", fake_write_section)
    monkeypatch.setattr(apipe.llm, "score_article", fake_score)
    monkeypatch.setattr(apipe.llm, "generate_metadata", fake_metadata)
    monkeypatch.setattr(apipe.llm, "generate_schema_json", fake_schema)
    monkeypatch.setattr(apipe.llm, "interlink_suggest", fake_interlink)
    monkeypatch.setattr(apipe.llm, "generate_hero_prompt", fake_hero_prompt)

    async def fake_keyframe(prompt, out_path, *, quality="medium", size=None, reference_image_path=None, spend=None):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"png")
        return out_path

    monkeypatch.setattr(apipe.openai_images, "generate_keyframe", fake_keyframe)

    from marketer.config import settings
    monkeypatch.setattr(settings, "artifacts_dir", str(tmp_path / "artifacts"))
    monkeypatch.setattr(settings, "article_hero_image", True)

    return state


# ---------------------------------------------------------------------------
# 1. Writer-model fallback (unit level, on provider_fallback + llm.write_section)
# ---------------------------------------------------------------------------


def test_writer_fallback_chain_differs_from_primary(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "article_writer_model", "gpt-writer-primary")
    monkeypatch.setattr(settings, "agent_model", "gpt-agent-default")
    chain = provider_fallback.writer_model_fallback_chain(settings.article_writer_model)
    assert chain == ["gpt-writer-primary", "gpt-agent-default"]


def test_writer_fallback_chain_collapses_when_same_model(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "article_writer_model", "gpt-5.4-mini")
    monkeypatch.setattr(settings, "agent_model", "gpt-5.4-mini")
    chain = provider_fallback.writer_model_fallback_chain(settings.article_writer_model)
    assert chain == ["gpt-5.4-mini"]


async def test_call_with_model_fallback_falls_back_on_persistent_failure():
    calls: list[str] = []

    async def flaky(model: str) -> str:
        calls.append(model)
        if model == "primary":
            raise RuntimeError("model deprecated")
        return f"ok from {model}"

    result, used = await provider_fallback.call_with_model_fallback(
        flaky, ["primary", "fallback"],
    )
    assert result == "ok from fallback"
    assert used == "fallback"
    assert calls == ["primary", "fallback"]


async def test_call_with_model_fallback_propagates_spend_cap():
    async def capped(model: str) -> str:
        raise SpendCapExceeded("cap hit", scope="niche")

    with pytest.raises(SpendCapExceeded):
        await provider_fallback.call_with_model_fallback(capped, ["primary", "fallback"])


async def test_call_with_model_fallback_single_model_raises_original():
    async def boom(model: str) -> str:
        raise RuntimeError("only model, no fallback target")

    with pytest.raises(RuntimeError, match="only model"):
        await provider_fallback.call_with_model_fallback(boom, ["primary"])


async def test_write_section_falls_back_to_agent_model(monkeypatch):
    """The real llm.write_section: primary article_writer_model fails
    persistently, agent_model produces the section, article writer keeps
    going (proven end to end by the pipeline test below)."""
    from marketer.config import settings
    from marketer.articles.models import SectionContext

    monkeypatch.setattr(settings, "article_writer_model", "gpt-writer-broken")
    monkeypatch.setattr(settings, "agent_model", "gpt-agent-default")

    calls: list[str] = []

    class _FakeMessage:
        def __init__(self, content):
            self.content = content

    class _FakeChoice:
        def __init__(self, content):
            self.message = _FakeMessage(content)

    class _FakeResp:
        def __init__(self, content):
            self.choices = [_FakeChoice(content)]
            self.usage = None

    class _FakeCompletions:
        async def create(self, *, model, messages, temperature):
            calls.append(model)
            if model == "gpt-writer-broken":
                raise RuntimeError("writer provider outage")
            return _FakeResp("## Grind Size Basics\n\nBody text here.")

    class _FakeChat:
        completions = _FakeCompletions()

    class _FakeClient:
        chat = _FakeChat()

    monkeypatch.setattr(llm, "_oai", lambda: _FakeClient())

    outline = _outline()
    ctx = SectionContext(
        title=outline.title, topic="espresso", focusKeyword="dial in espresso",
        tone="warm", targetAudience="hobbyists", outline=outline,
    )
    text = await llm.write_section("Grind Size Basics", "cover burrs", ctx, spend=None)
    assert "Body text here" in text
    assert calls == ["gpt-writer-broken", "gpt-agent-default"]


async def test_article_completes_via_writer_fallback(stub_all, monkeypatch):
    """End-to-end: the article-level write_section (not stubbed away)
    exercises the real fallback path and the article still reaches done."""
    from marketer.config import settings

    monkeypatch.setattr(settings, "article_writer_model", "gpt-writer-broken")
    monkeypatch.setattr(settings, "agent_model", "gpt-agent-default")

    # Undo the blanket write_section stub from stub_all so we exercise the
    # real llm.write_section fallback logic, with only the OpenAI transport
    # faked.
    calls: list[str] = []

    class _FakeMessage:
        def __init__(self, content):
            self.content = content

    class _FakeChoice:
        def __init__(self, content):
            self.message = _FakeMessage(content)

    class _FakeResp:
        def __init__(self, content):
            self.choices = [_FakeChoice(content)]
            self.usage = None

    class _FakeCompletions:
        async def create(self, *, model, messages, temperature):
            calls.append(model)
            if model == "gpt-writer-broken":
                raise RuntimeError("writer provider outage")
            heading = messages[1]["content"].split("Section heading: ")[1].split("\n")[0]
            return _FakeResp(f"## {heading}\n\nHow to dial in espresso at home.")

    class _FakeChat:
        completions = _FakeCompletions()

    class _FakeClient:
        chat = _FakeChat()

    monkeypatch.setattr(llm, "_oai", lambda: _FakeClient())
    monkeypatch.setattr(apipe.llm, "write_section", _REAL_WRITE_SECTION)

    art = await apipe.run_article(user_id=USER_ID, niche_id=NICHE_ID, topic="espresso")
    assert art.status == ArticleStatus.done
    # every section attempted the broken primary first, then fell back
    assert calls.count("gpt-writer-broken") >= 1
    assert calls.count("gpt-agent-default") >= 1


# ---------------------------------------------------------------------------
# 2. Hero-image graceful degradation
# ---------------------------------------------------------------------------


async def test_hero_image_failure_degrades_article_completes(stub_all, monkeypatch):
    async def boom_hero(prompt, out_path, *, quality="medium", size=None,
                         reference_image_path=None, spend=None):
        raise RuntimeError("content policy rejection")

    monkeypatch.setattr(apipe.openai_images, "generate_keyframe", boom_hero)

    art = await apipe.run_article(user_id=USER_ID, niche_id=NICHE_ID, topic="espresso")
    assert art.status == ArticleStatus.done
    assert art.hero_image_path is None
    assert art.error is None
    # article still progressed through every essential stage
    for stage in ("outlining", "writing", "qa", "metadata", "imaging"):
        assert stage in stub_all["statuses"]


async def test_hero_prompt_failure_degrades_article_completes(stub_all, monkeypatch):
    async def boom_prompt(title, kw, md, *, spend=None):
        raise RuntimeError("hero prompt generation exploded")

    monkeypatch.setattr(apipe.llm, "generate_hero_prompt", boom_prompt)

    art = await apipe.run_article(user_id=USER_ID, niche_id=NICHE_ID, topic="espresso")
    assert art.status == ArticleStatus.done
    assert art.hero_image_path is None


async def test_hero_image_spend_cap_still_fails_article(stub_all, monkeypatch):
    """Non-essential-stage degradation must never swallow a real spend-cap
    breach — that's a money guardrail, not a hero-image problem."""

    async def capped_hero(prompt, out_path, *, quality="medium", size=None,
                           reference_image_path=None, spend=None):
        raise SpendCapExceeded("niche hit daily cap", scope="niche")

    monkeypatch.setattr(apipe.openai_images, "generate_keyframe", capped_hero)

    art = await apipe.run_article(user_id=USER_ID, niche_id=NICHE_ID, topic="espresso")
    assert art.status == ArticleStatus.failed
    assert "cap" in (art.error or "")


# ---------------------------------------------------------------------------
# 3. Spend-cap breach elsewhere still fails the whole article cleanly
# ---------------------------------------------------------------------------


async def test_spend_cap_in_outline_stage_fails_article(stub_all, monkeypatch):
    async def capped(topic, keyword, research, tone, audience, *, spend=None):
        raise SpendCapExceeded("global daily cap hit", scope="global")

    monkeypatch.setattr(apipe.llm, "generate_outline", capped)
    art = await apipe.run_article(user_id=USER_ID, niche_id=NICHE_ID, topic="espresso")
    assert art.status == ArticleStatus.failed
    assert "cap" in (art.error or "")
