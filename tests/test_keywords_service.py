"""Unit tests for marketer.services.keyword_research: the difficulty
heuristic on crafted SERPs, and the harvest() LLM call's spend metering /
fail-soft contract (fake OpenAI + Exa transports, no network)."""
from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import httpx
import openai
import pytest

from marketer.services import keyword_research as kr

# --------------------------------------------------------------------------- score_from_pages heuristic


def _page(title="", url="https://example.com/blog/post", domain=None):
    return {"title": title, "url": url, "domain": domain or "", "excerpt": ""}


def test_score_from_pages_empty_serp_returns_none_difficulty():
    result = kr.score_from_pages("kw", [])
    assert result.difficulty is None
    assert result.top_domains == []


def test_score_from_pages_big_brand_dominated_serp_is_hard():
    pages = [
        _page(title="Espresso guide", url="https://www.wikipedia.org/wiki/Espresso", domain="wikipedia.org"),
        _page(title="Best grinders", url="https://www.reddit.com/r/coffee/x", domain="reddit.com"),
        _page(title="Grinder reviews", url="https://www.forbes.com/grinders", domain="forbes.com"),
        _page(title="Coffee 101", url="https://www.nytimes.com/coffee", domain="nytimes.com"),
        _page(title="Grinder picks", url="https://www.amazon.com/grinders", domain="amazon.com"),
    ]
    result = kr.score_from_pages("best espresso grinders", pages)
    # 5 big-brand hits * 10 = 50 (capped), no title/homepage signal here.
    assert result.difficulty == 50.0
    assert result.top_domains == [
        "wikipedia.org", "reddit.com", "forbes.com", "nytimes.com", "amazon.com",
    ]


def test_score_from_pages_exact_title_matches_add_difficulty():
    kw = "best budget espresso machine"
    pages = [
        _page(title="Best Budget Espresso Machine", url="https://a.com/1", domain="a.com"),
        _page(title="The Best Budget Espresso Machine of 2026", url="https://b.com/2", domain="b.com"),
        _page(title="Unrelated coffee tips", url="https://c.com/3", domain="c.com"),
    ]
    result = kr.score_from_pages(kw, pages)
    # 2 exact-phrase title hits * 6 = 12, no brand/homepage signal.
    assert result.difficulty == 12.0


def test_score_from_pages_homepage_heavy_serp_is_harder():
    pages = [
        _page(title="Acme Coffee Co", url="https://acme-coffee.com/", domain="acme-coffee.com"),
        _page(title="Bean Roasters", url="https://beanroasters.com", domain="beanroasters.com"),
        _page(title="A deep-dive article", url="https://blog.example.com/deep-dive-article", domain="example.com"),
    ]
    result = kr.score_from_pages("kw with no title overlap", pages)
    # 2 homepage hits * 10 = 20, no brand/title signal.
    assert result.difficulty == 20.0


def test_score_from_pages_thin_long_tail_serp_is_easy():
    pages = [
        _page(title="A random blog post", url="https://smallblog.example.com/2024/post", domain="smallblog.example.com"),
        _page(title="Another unrelated page", url="https://tinyshop.example.com/products/x", domain="tinyshop.example.com"),
    ]
    result = kr.score_from_pages("very specific long tail keyword phrase", pages)
    assert result.difficulty == 0.0


def test_score_from_pages_combined_signals_clamped_to_100():
    kw = "best coffee grinder"
    pages = [
        _page(title="Best Coffee Grinder", url="https://www.wikipedia.org/", domain="wikipedia.org"),
        _page(title="Best Coffee Grinder", url="https://www.reddit.com/", domain="reddit.com"),
        _page(title="Best Coffee Grinder", url="https://www.forbes.com/", domain="forbes.com"),
        _page(title="Best Coffee Grinder", url="https://www.nytimes.com/", domain="nytimes.com"),
        _page(title="Best Coffee Grinder", url="https://www.amazon.com/", domain="amazon.com"),
        _page(title="Best Coffee Grinder", url="https://www.moz.com/", domain="moz.com"),
    ]
    result = kr.score_from_pages(kw, pages)
    assert result.difficulty == 100.0  # 50 (brand, capped) + 30 (title, capped) + 20 (homepage, capped)


def test_score_from_pages_falls_back_to_deriving_domain_from_url():
    # No "domain" key in the page dict at all — score_from_pages must derive
    # it from the URL itself (same fallback articles.exa.serp_pages's own
    # output never needs, but a caller could still hand this in raw).
    pages = [{"title": "Espresso guide", "url": "https://www.wikipedia.org/wiki/Espresso", "excerpt": ""}]
    result = kr.score_from_pages("unrelated keyword phrase", pages)
    assert result.top_domains == ["wikipedia.org"]
    assert result.difficulty == 10.0  # 1 big-brand hit * 10, no title/homepage signal


# --------------------------------------------------------------------------- score_difficulty (Exa fetch)


async def test_score_difficulty_none_when_exa_unconfigured(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "exa_api_key", "")
    result = await kr.score_difficulty("some keyword")
    assert result.difficulty is None
    assert result.keyword == "some keyword"


async def test_score_difficulty_uses_serp_pages_when_configured(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "exa_api_key", "exa-test-key")

    async def _fake_serp_pages(keyword, num_results=10):
        assert keyword == "espresso grinders"
        return [_page(title="Espresso Grinders", url="https://www.wikipedia.org/", domain="wikipedia.org")]

    monkeypatch.setattr(kr, "serp_pages", _fake_serp_pages)
    result = await kr.score_difficulty("espresso grinders")
    assert result.difficulty is not None
    assert result.difficulty > 0


async def test_score_difficulty_fail_soft_on_serp_pages_exception(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "exa_api_key", "exa-test-key")

    async def _boom(keyword, num_results=10):
        raise httpx.ConnectTimeout("timed out")

    monkeypatch.setattr(kr, "serp_pages", _boom)
    result = await kr.score_difficulty("espresso grinders")
    assert result.difficulty is None


# --------------------------------------------------------------------------- harvest() LLM call


def _fake_openai_client(picks: list[dict], *, input_tokens=1000, output_tokens=500):
    """Minimal stand-in for openai.AsyncOpenAI covering the one method
    harvest() calls: client.beta.chat.completions.parse(...)."""
    parsed = kr.HarvestBatch(keywords=[kr.HarvestPick(**p) for p in picks])
    usage = SimpleNamespace(prompt_tokens=input_tokens, completion_tokens=output_tokens)
    message = SimpleNamespace(parsed=parsed)
    resp = SimpleNamespace(choices=[SimpleNamespace(message=message)], usage=usage)

    calls: list[dict] = []

    async def _parse(**kwargs):
        calls.append(kwargs)
        return resp

    client = SimpleNamespace(
        beta=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(parse=_parse)))
    )
    return client, calls


async def test_harvest_logs_spend_and_returns_picks(monkeypatch, fake_spend):
    ctx, rec = fake_spend
    picks = [
        {"keyword": "best espresso grinder", "intent": "commercial", "rationale": "high intent"},
        {"keyword": "espresso vs drip coffee", "intent": "informational", "rationale": "broad awareness"},
    ]
    client, calls = _fake_openai_client(picks)
    monkeypatch.setattr(kr, "_oai", lambda: client)

    niche = SimpleNamespace(title="home espresso", description="dial-in guides")
    result = await kr.harvest(niche, None, ["existing kw"], 2, spend=ctx)

    assert [p.keyword for p in result] == [p["keyword"] for p in picks]
    assert len(calls) == 1
    assert calls[0]["response_format"] is kr.HarvestBatch

    assert len(rec.entries) == 1
    entry = rec.entries[0]
    assert entry.provider == "openai"
    assert entry.sku.startswith("llm:")
    assert entry.units == Decimal(1500)
    assert entry.cost_usd > 0


async def test_harvest_truncates_to_requested_n(monkeypatch, fake_spend):
    ctx, _ = fake_spend
    picks = [{"keyword": f"kw{i}", "intent": "", "rationale": ""} for i in range(5)]
    client, _ = _fake_openai_client(picks)
    monkeypatch.setattr(kr, "_oai", lambda: client)

    niche = SimpleNamespace(title="t", description="d")
    result = await kr.harvest(niche, None, [], 2, spend=ctx)
    assert len(result) == 2


async def test_harvest_propagates_spend_cap_exceeded(monkeypatch, fake_spend):
    from marketer.repos.spend import SpendCapExceeded

    ctx, _ = fake_spend
    ctx.abort_event.set()  # a sibling task already tripped the cap

    client, calls = _fake_openai_client([{"keyword": "kw", "intent": "", "rationale": ""}])
    monkeypatch.setattr(kr, "_oai", lambda: client)

    niche = SimpleNamespace(title="t", description="d")
    with pytest.raises(SpendCapExceeded):
        await kr.harvest(niche, None, [], 3, spend=ctx)
    assert calls == []  # blocked pre-flight, provider never called


async def test_harvest_fail_soft_on_openai_error(monkeypatch, fake_spend):
    ctx, rec = fake_spend

    async def _boom(**kwargs):
        request = httpx.Request("POST", "https://api.openai.com/v1/x")
        raise openai.APIConnectionError(request=request)

    client = SimpleNamespace(
        beta=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(parse=_boom)))
    )
    monkeypatch.setattr(kr, "_oai", lambda: client)

    niche = SimpleNamespace(title="t", description="d")
    result = await kr.harvest(niche, None, [], 3, spend=ctx)
    assert result == []
    assert rec.entries == []  # nothing spent on a failed call


async def test_harvest_fail_soft_on_none_parsed(monkeypatch, fake_spend):
    ctx, rec = fake_spend
    usage = SimpleNamespace(prompt_tokens=10, completion_tokens=5)
    message = SimpleNamespace(parsed=None)
    resp = SimpleNamespace(choices=[SimpleNamespace(message=message)], usage=usage)

    async def _parse(**kwargs):
        return resp

    client = SimpleNamespace(
        beta=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(parse=_parse)))
    )
    monkeypatch.setattr(kr, "_oai", lambda: client)

    niche = SimpleNamespace(title="t", description="d")
    result = await kr.harvest(niche, None, [], 3, spend=ctx)
    assert result == []
    # A malformed/empty parse still logs the (real) token spend before
    # returning nothing — the call happened and cost money either way.
    assert len(rec.entries) == 1


async def test_harvest_without_spend_context_still_runs(monkeypatch):
    picks = [{"keyword": "kw", "intent": "", "rationale": ""}]
    client, calls = _fake_openai_client(picks)
    monkeypatch.setattr(kr, "_oai", lambda: client)

    niche = SimpleNamespace(title="t", description="d")
    result = await kr.harvest(niche, None, [], 1, spend=None)
    assert len(result) == 1
    assert len(calls) == 1
