"""End-to-end tests for the article pipeline (all externals stubbed)."""
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

USER_ID = "user_article_e2e"
NICHE_ID = UUID("00000000-0000-0000-0000-00000000a001")


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
    """Stub repos + LLM + Exa + image gen; return the mutable state dict."""
    state: dict = {"saved": [], "statuses": [], "scored": 0}
    article_holder: dict = {}

    async def fake_niche_get(niche_id, *, user_id):
        return _niche()

    monkeypatch.setattr(apipe.niches_repo, "get", fake_niche_get)

    # No brand kit by default; the brand-voice blend test overrides this.
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

    # spend context: no DB
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

    # Exa: no SERP data (degraded research path)
    async def fake_serp_pages(keyword, num_results=8):
        return []

    monkeypatch.setattr(exa, "serp_pages", fake_serp_pages)
    monkeypatch.setattr(apipe.exa, "serp_pages", fake_serp_pages)

    # LLM stages
    async def fake_pick_topic(title, desc, recent, *, spend=None):
        return TopicPick(topic="dialing in espresso", focusKeyword="dial in espresso")

    async def fake_outline(topic, keyword, research, tone, audience, *, spend=None):
        return _outline()

    async def fake_write_section(heading, notes, ctx, *, spend=None):
        kw = ctx.focusKeyword
        return f"## {heading}\n\nHow to {kw} at home, step by step."

    async def fake_score(md, kw, *, spend=None):
        state["scored"] += 1
        overall = state.get("qa_score", 0.9)
        # After a rewrite, always pass.
        if state["scored"] > 1:
            overall = 0.9
        return QualityScore(
            overall=overall, keywordDensity=0.01, eeatScore=0.8,
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


async def test_happy_path_reaches_done(stub_all):
    art = await apipe.run_article(user_id=USER_ID, niche_id=NICHE_ID)
    assert art.status == ArticleStatus.done
    assert art.title == "Dial In Espresso at Home: Complete Guide"
    assert art.slug == "dial-in-espresso-at-home"
    assert art.article_markdown and art.article_markdown.startswith("# Dialing In Espresso")
    assert art.schema_jsonld and "schema.org" in art.schema_jsonld
    assert art.hero_image_path and art.hero_image_path.endswith("hero.png")
    assert art.word_count and art.word_count > 0
    assert art.link_suggestions and art.link_suggestions[0].targetUrl == "/old-espresso-post"
    # topic was auto-picked
    assert art.topic == "dialing in espresso"
    # stage progression persisted in order
    s = stub_all["statuses"]
    for a, b in [("researching", "outlining"), ("outlining", "writing"),
                 ("writing", "qa"), ("qa", "metadata"), ("metadata", "imaging"),
                 ("imaging", "done")]:
        assert s.index(a) < s.index(b)


async def test_low_qa_triggers_exactly_one_rewrite(stub_all):
    stub_all["qa_score"] = 0.3  # first score fails threshold
    art = await apipe.run_article(user_id=USER_ID, niche_id=NICHE_ID, topic="espresso")
    assert art.status == ArticleStatus.done
    assert stub_all["scored"] == 2  # initial + post-rewrite, never more


async def test_stage_exception_terminates_as_failed(stub_all, monkeypatch):
    async def boom(topic, keyword, research, tone, audience, *, spend=None):
        raise RuntimeError("outline exploded")

    monkeypatch.setattr(apipe.llm, "generate_outline", boom)
    art = await apipe.run_article(user_id=USER_ID, niche_id=NICHE_ID, topic="espresso")
    assert art.status == ArticleStatus.failed
    assert "outline exploded" in (art.error or "")


async def test_spend_cap_terminates_as_failed(stub_all, monkeypatch):
    from marketer.repos.spend import SpendCapExceeded

    async def capped(heading, notes, ctx, *, spend=None):
        raise SpendCapExceeded("niche hit daily cap", scope="niche")

    monkeypatch.setattr(apipe.llm, "write_section", capped)
    art = await apipe.run_article(user_id=USER_ID, niche_id=NICHE_ID, topic="espresso")
    assert art.status == ArticleStatus.failed
    assert "cap" in (art.error or "")


async def test_hero_image_skippable(stub_all, monkeypatch):
    from marketer.config import settings
    monkeypatch.setattr(settings, "article_hero_image", False)
    art = await apipe.run_article(user_id=USER_ID, niche_id=NICHE_ID, topic="espresso")
    assert art.status == ArticleStatus.done
    assert art.hero_image_path is None
    assert "imaging" not in stub_all["statuses"]


def test_compose_tone_blends_brand():
    from marketer.repos.brand_kit import BrandKit

    # No brand → niche tone (or the sane default) passes through unchanged.
    assert apipe._compose_tone("", None) == "professional, clear"
    assert apipe._compose_tone("punchy", None) == "punchy"

    brand = BrandKit(tone_of_voice="warm and expert", banned_words=["cheap", "guru"])
    blended = apipe._compose_tone("punchy", brand)
    assert "punchy" in blended
    assert "Brand voice: warm and expert" in blended
    assert "Never use these words: cheap, guru" in blended


async def test_brand_voice_reaches_the_writer(stub_all, monkeypatch):
    """A configured brand kit must flow into the tone the outliner/writer see,
    so long-form articles come out on-brand — not just niche drafts."""
    from marketer.repos.brand_kit import BrandKit

    stub_all["brand"] = BrandKit(
        tone_of_voice="warm and expert", banned_words=["cheap"]
    )

    seen: dict = {}

    async def capture_outline(topic, keyword, research, tone, audience, *, spend=None):
        seen["tone"] = tone
        return _outline()

    monkeypatch.setattr(apipe.llm, "generate_outline", capture_outline)

    art = await apipe.run_article(user_id=USER_ID, niche_id=NICHE_ID, topic="espresso")
    assert art.status == ArticleStatus.done
    assert "Brand voice: warm and expert" in seen["tone"]
    assert "Never use these words: cheap" in seen["tone"]


def test_strip_ai_dashes():
    assert llm.strip_ai_dashes("A—B") == "A, B"
    assert llm.strip_ai_dashes("A — B") == "A, B"
    assert llm.strip_ai_dashes("2019–2024") == "2019-2024"
    assert llm.strip_ai_dashes("plain text") == "plain text"
    assert llm.strip_ai_dashes("") == ""
