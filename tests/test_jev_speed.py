"""Speed / reliability wave — cache, planner, captions, article fastpaths."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from marketer.articles import fastpath
from marketer.articles.models import TopicPick
from marketer.jev import cache as ask_cache
from marketer.jev import planner
from marketer.jev.client import noul
from marketer.jev.primitives import NoulAnswer, SystemOneResult, Usage
from marketer.models import Idea, Scene, Script
from marketer.services import subtitle


@pytest.fixture(autouse=True)
def _clear_ask_cache():
    ask_cache.clear()
    yield
    ask_cache.clear()


def _script(*, visual: str = "a vivid still of a copper espresso machine on marble",
            motion: str = "slow push-in, subtle steam") -> Script:
    return Script(
        idea=Idea(topic="t", angle="a", hook="h", target_audience="x", why_it_works="y"),
        scenes=[
            Scene(index=0, narration="Stop wasting shots.", visual_prompt=visual,
                  motion_prompt=motion, duration_sec=4.0),
            Scene(index=1, narration="Dial the grind first.", visual_prompt=visual,
                  motion_prompt=motion, duration_sec=4.0),
        ],
        total_duration_sec=8.0,
    )


def test_ask_cache_key_is_stable():
    q = {"ok": noul("Is this fine?")}
    a = ask_cache.cache_key({"x": 1}, q, "jev")
    b = ask_cache.cache_key({"x": 1}, q, "jev")
    c = ask_cache.cache_key({"x": 2}, q, "jev")
    assert a == b and a != c


async def test_ask_cache_skips_second_backend_and_spend(monkeypatch):
    from marketer.jev.ask import ask

    calls = {"n": 0}

    async def fake_system_one(state, questions, **kw):
        calls["n"] += 1
        return SystemOneResult(
            model="jev-1.13.0",
            answers={"q": NoulAnswer(noul=0.9)},
            usage=Usage(input_tokens=50),
            backend="jev",
        )

    from marketer.jev import client as jev_client

    monkeypatch.setattr(jev_client, "enabled", lambda: True)
    monkeypatch.setattr(jev_client, "system_one", fake_system_one)
    first = await ask("same", {"q": noul("yes?")}, use_cache=True)
    second = await ask("same", {"q": noul("yes?")}, use_cache=True)
    assert first.noul("q").noul == second.noul("q").noul == 0.9
    assert calls["n"] == 1
    assert ask_cache.size() == 1


def test_script_has_usable_visuals_thresholds():
    assert planner.script_has_usable_visuals(_script()) is True
    stub = _script(visual="vp0", motion="mp0")
    assert planner.script_has_usable_visuals(stub) is False
    assert planner.script_has_caption_source(_script()) is True
    empty = _script()
    empty.scenes[0].narration = ""
    empty.scenes[1].narration = ""
    assert planner.script_has_caption_source(empty) is False


async def test_plan_video_run_dark_defaults(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "jev_enabled", True)
    monkeypatch.setattr(planner, "available", lambda: False)
    plan = await planner.plan_video_run({"niche": "espresso"})
    assert plan.backend == "none"
    assert plan.caption_source == "script"
    assert plan.prefer_skip_visual_director is True
    assert plan.model_id


async def test_plan_video_run_respects_operator_model(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "jev_enabled", True)
    monkeypatch.setattr(planner, "available", lambda: True)

    async def boom(*_a, **_k):
        raise AssertionError("planner must not call Jev when operator pinned a model")

    monkeypatch.setattr(planner, "jev_ask", boom)
    plan = await planner.plan_video_run({"niche": "x"}, script_model="qwen/qwen3-8b")
    assert plan.backend == "operator"
    assert plan.model_id == "qwen/qwen3-8b"


async def test_plan_video_run_one_fan_out(monkeypatch):
    from marketer.config import settings
    from marketer.jev.primitives import ChoiceAnswer

    monkeypatch.setattr(settings, "jev_enabled", True)
    monkeypatch.setattr(planner, "available", lambda: True)

    async def fake_ask(state, questions, *, spend=None, prefer="jev"):
        assert "tier" in questions and "skip_vd" in questions and "captions" in questions
        return SystemOneResult(
            model="jev-latest",
            answers={
                "tier": ChoiceAnswer(
                    choice="fast",
                    probabilities={"fast": 0.8, "standard": 0.2},
                    confidence=0.9,
                ),
                "skip_vd": NoulAnswer(noul=0.8),
                "captions": ChoiceAnswer(
                    choice="script",
                    probabilities={"script": 0.9, "whisper": 0.1},
                    confidence=0.85,
                ),
            },
            backend="jev",
        )

    monkeypatch.setattr(planner, "jev_ask", fake_ask)
    plan = await planner.plan_video_run({"niche": "espresso"})
    assert plan.tier == "fast"
    assert plan.model_id == "qwen/qwen3-8b"
    assert plan.caption_source == "script"
    assert plan.prefer_skip_visual_director is True


def test_script_to_words_covers_narration_and_scales():
    scenes = [
        SimpleNamespace(narration="hello world", duration_sec=2.0),
        SimpleNamespace(narration="again", duration_sec=2.0),
    ]
    words = subtitle.script_to_words(scenes)
    assert [w["word"] for w in words] == ["hello", "world", "again"]
    assert words[0]["start"] == 0.0
    assert words[-1]["end"] <= 4.0
    stretched = subtitle.script_to_words(scenes, total_duration_sec=8.0)
    assert stretched[-1]["end"] <= 8.0
    assert stretched[-1]["end"] > words[-1]["end"]


def test_serp_from_pages_needs_no_llm():
    pages = [
        {
            "title": "Dial in espresso at home",
            "url": "https://a.example/espresso",
            "domain": "a.example",
            "wordCountEstimate": 1800,
            "highlights": ["grind size first"],
            "excerpt": "What grind size should I use?\nA practical start.",
        },
        {
            "title": "Espresso ratio guide",
            "url": "https://b.example/ratio",
            "domain": "b.example",
            "wordCountEstimate": 1200,
            "highlights": [],
            "excerpt": "",
        },
    ]
    serp = fastpath.serp_from_pages("espresso", pages)
    assert len(serp.topResults) == 2
    assert "a.example" in serp.topDomains
    assert serp.recommendedWordCount >= 800
    assert any("grind" in q.lower() or q.endswith("?") for q in serp.questionsAnswered)


def test_schema_json_is_deterministic_graph():
    md = (
        "# Title\n\n"
        "## Grind Size Basics\n\n"
        "Start coarse and step finer until the shot tastes sweet.\n\n"
        "## Dose and Yield\n\n"
        "A 1:2 ratio is the default starting point.\n"
    )
    raw = fastpath.schema_json(
        title="Dial In Espresso",
        slug="dial-in-espresso",
        meta_description="Learn to dial in espresso at home.",
        focus_keyword="dial in espresso",
        keywords=["espresso", "grind"],
        article_md=md,
    )
    assert "schema.org" in raw
    assert "Article" in raw
    assert "FAQPage" in raw
    assert "Grind Size" in raw


def test_interlink_lexical_ranks_overlap():
    md = "# Dialing In Espresso\n\nHow to pull a better espresso shot at home."
    links = fastpath.interlink_lexical(
        md,
        [
            {"title": "Old Espresso Post", "slug": "old-espresso-post"},
            {"title": "Unrelated Gardening", "slug": "gardening"},
        ],
    )
    assert links
    assert links[0].targetUrl == "/old-espresso-post"
    assert links[0].score > 0


def test_topic_candidates_skip_recent_and_need_no_llm():
    recent = ["How home espresso actually works"]
    unused = fastpath.unused_topic_candidates(
        "home espresso", "dialing in espresso at home", recent, audience="hobbyists"
    )
    assert unused
    assert all(p.topic != "How home espresso actually works" for p in unused)


async def test_pick_topic_uses_template_when_jev_dark(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "jev_enabled", False)

    called = {"llm": 0}

    async def boom(*_a, **_k):
        called["llm"] += 1
        return TopicPick(topic="should not run", focusKeyword="x")

    import marketer.articles.llm as llm_mod

    monkeypatch.setattr(llm_mod, "pick_topic", boom)
    pick = await fastpath.pick_topic(
        "home espresso", "dialing in", ["Old Espresso Post"], audience="hobbyists"
    )
    assert pick.topic
    assert pick.focusKeyword
    assert called["llm"] == 0


def test_hero_prompt_is_template():
    prompt = fastpath.hero_prompt("Dial In Espresso", "dial in espresso")
    assert "dial in espresso" in prompt.prompt
    assert prompt.altText
    assert prompt.type == "hero"


async def test_route_intent_picks_model_in_same_fan_out(monkeypatch):
    from marketer.jev import router
    from marketer.jev.primitives import ChoiceAnswer, ScoreAnswer

    async def fake_ask(state, questions, *, spend=None, prefer="jev"):
        assert "tier" in questions
        return SystemOneResult(
            model="jev-latest",
            answers={
                "kind": ChoiceAnswer(
                    choice="video", probabilities={"video": 0.9, "other": 0.1},
                    confidence=0.9,
                ),
                "skill": ChoiceAnswer(
                    choice="write_script",
                    probabilities={"write_script": 0.8, "none": 0.2},
                    confidence=0.85,
                ),
                "needs_skill": NoulAnswer(noul=0.9),
                "urgency": ScoreAnswer(
                    score=2, legend={"0": "a", "1": "b", "2": "c", "3": "d"},
                    confidence=0.8,
                ),
                "tier": ChoiceAnswer(
                    choice="standard",
                    probabilities={"fast": 0.2, "standard": 0.7, "powerful": 0.1},
                    confidence=0.8,
                ),
            },
            backend="jev",
        )

    monkeypatch.setattr(router, "jev_ask", fake_ask)
    route = await router.route_intent({"request": "write a reel"})
    assert route.kind == "video"
    assert route.model is not None
    assert route.model.model_id == "qwen/qwen3-32b"


def test_compact_state_keeps_short_fields():
    from marketer.jev.grounding import compact_state

    huge = "x" * 8000
    out = compact_state({"id": "abc", "flag": True, "blob": huge, "items": list(range(20))})
    assert isinstance(out, dict)
    assert out.get("id") == "abc"
    assert out.get("flag") is True
    raw = __import__("json").dumps(out, default=str)
    assert len(raw) <= 4000


def test_extract_claims_and_fact_lock():
    from marketer.articles.models import SerpAnalysis, SerpResult
    from marketer.jev.grounding import (
        allowed_facts,
        extract_claim_sentences,
        strip_ungrounded_claims,
    )

    text = (
        "Dial in espresso at home. Research shows 87% of shots fail. "
        "A 2024 study claimed $400 machines win. Start with grind size."
    )
    claims = extract_claim_sentences(text)
    assert any("87%" in c for c in claims)
    research = SerpAnalysis(
        topResults=[
            SerpResult(
                title="Espresso",
                url="https://a.example",
                domain="a.example",
                highlights=["In 2024 a $400 machine pulled sweeter shots."],
            )
        ]
    )
    allowed = allowed_facts(research)
    assert "2024" in allowed
    assert "$400" in allowed
    cleaned, notes = strip_ungrounded_claims(text, allowed)
    assert "87%" not in cleaned
    assert notes
    assert "2024" in cleaned or "$400" in cleaned or "grind" in cleaned.lower()


def test_outline_and_metadata_are_deterministic():
    from marketer.articles.models import SerpAnalysis

    serp = SerpAnalysis(
        commonHeadings=["Grind size basics"],
        questionsAnswered=["What grind size should I use?"],
        commonTopics=["grind"],
    )
    outline = fastpath.outline_from_research("espresso", "espresso", serp)
    assert outline.title == "espresso"
    assert any(s.level == 2 for s in outline.sections)
    assert 6 <= len(outline.sections) <= 11
    meta = fastpath.metadata_from_article(
        "espresso",
        "espresso",
        "# espresso\n\nStart with a consistent 18 gram dose and a 1:2 ratio.\n",
    )
    assert meta.slug == "espresso"
    assert "espresso" in meta.title.casefold()
    assert meta.metaDescription


def test_idea_candidates_are_templates():
    from marketer.agents.ideation import idea_candidates

    ideas = idea_candidates(
        "home espresso",
        niche_description="dial in at home",
        target_audience="hobbyists",
        recent_topics=["The home espresso mistake that wastes the first week"],
    )
    assert len(ideas) >= 2
    assert all(ideas[0].topic != i.topic for i in ideas[1:])
    assert all("home espresso" in (i.topic + i.hook).casefold() or "hobbyists" in i.topic.casefold()
               for i in ideas)


async def test_source_audit_penalty_skips_when_no_claims():
    from marketer.jev.loops import source_audit_penalty

    notes, penalty = await source_audit_penalty(
        "Just grind finer and taste.",
        [{"domain": "a.example", "highlights": ["87%"]}],
    )
    assert notes == []
    assert penalty == 0.0


async def test_plan_video_run_cascade_bumps_fast_after_qa_fail(monkeypatch):
    from marketer.config import settings
    from marketer.jev.primitives import ChoiceAnswer

    monkeypatch.setattr(settings, "jev_enabled", True)
    monkeypatch.setattr(planner, "available", lambda: True)

    async def fake_ask(state, questions, *, spend=None, prefer="jev"):
        return SystemOneResult(
            model="jev-latest",
            answers={
                "tier": ChoiceAnswer(
                    choice="fast",
                    probabilities={"fast": 0.9, "standard": 0.1},
                    confidence=0.9,
                ),
                "skip_vd": NoulAnswer(noul=0.8),
                "captions": ChoiceAnswer(
                    choice="script",
                    probabilities={"script": 0.9, "whisper": 0.1},
                    confidence=0.85,
                ),
            },
            backend="jev",
        )

    monkeypatch.setattr(planner, "jev_ask", fake_ask)
    plan = await planner.plan_video_run({"niche": "espresso", "prior_qa_failed": True})
    assert plan.tier == "standard"
    assert plan.model_id == "qwen/qwen3-32b"


def test_faq_section_and_publishable_metadata():
    from marketer.articles.models import SerpAnalysis, SerpResult

    serp = SerpAnalysis(
        questionsAnswered=["What grind size should I use?", "What ratio should I start with?"],
        commonTopics=["grind"],
        topResults=[
            SerpResult(
                title="Espresso",
                url="https://a.example",
                domain="a.example",
                highlights=["Start at 18 grams and a 1:2 ratio."],
            )
        ],
    )
    faq = fastpath.faq_section_from_research("FAQ", serp)
    assert faq and faq.startswith("## FAQ")
    assert "grind" in faq.casefold() or "ratio" in faq.casefold()
    assert fastpath.faq_section_from_research("Grind size", serp) is None
    assert fastpath.metadata_is_publishable(
        "Dial in espresso at home: a practical guide",
        "A practical guide to espresso for home baristas who want sweeter, more consistent shots every morning.",
        "espresso",
    )
    assert not fastpath.metadata_is_publishable("x", "short", "espresso")
