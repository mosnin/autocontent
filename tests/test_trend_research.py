"""Trend research: query building, grounding, repair, and metering.

No network and no DB. Exa is stubbed at `articles.exa.serp_pages` (the
same seam the article pipeline uses) and the Agents SDK is stubbed at
`agents.metered.Runner`, which means the REAL `run_metered` runs — so the
metering assertions here are about the actual spend path, not a mock of
it.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import pytest

from marketer.agents import metered
from marketer.articles import exa
from marketer.formats import registry
from marketer.models import Niche, PostingWindow
from marketer.repos.spend import SpendCapExceeded
from marketer.research import trends
from marketer.services.spend_context import SpendContext

NICHE_ID = UUID("11111111-1111-1111-1111-111111111111")


def make_niche(**kw) -> Niche:
    base = dict(
        id=NICHE_ID,
        user_id="user_test",
        title="Home espresso",
        description="Short videos about pulling better shots at home",
        target_audience="beginners with an entry-level machine",
        hashtags=["#coffee"],
        visual_style="warm kitchen macro",
        voice="friendly",
        target_duration_sec=30,
        scene_count=5,
        posting_windows=[PostingWindow(hour=9, minute=0, tz="UTC")],
        platforms=["tiktok"],
        daily_spend_cap_usd=Decimal("5.00"),
        created_at=datetime.now(timezone.utc),
    )
    base.update(kw)
    return Niche(**base)


def make_pages(n: int = 2) -> list[dict]:
    return [
        {
            "title": f"Result {i}",
            "url": f"https://example{i}.com/post",
            "domain": f"example{i}.com",
            "highlights": [f"people keep asking about thing {i}"],
            "excerpt": f"long body text {i}",
        }
        for i in range(n)
    ]


# --------------------------------------------------------- fake SDK plumbing


class FakeUsage:
    input_tokens = 1200
    output_tokens = 400
    total_tokens = 1600


class FakeWrapper:
    usage = FakeUsage()


class FakeResult:
    def __init__(self, findings: trends.TrendFindings) -> None:
        self._findings = findings
        self.context_wrapper = FakeWrapper()

    def final_output_as(self, _cls):
        return self._findings


def default_findings() -> trends.TrendFindings:
    return trends.TrendFindings(
        themes=[trends.TrendTheme(theme="pressure profiling", why_now="new cheap gear")],
        hooks=[
            trends.TrendHook(
                hook="why your first shot is always sour",
                open_loop="what makes the first shot different",
            )
        ],
        angles=[
            trends.TrendAngle(
                title="why the first shot is sour", format_key="explainer", why="mechanism"
            )
        ],
    )


def stub_runner(monkeypatch, findings: trends.TrendFindings | None = None) -> list[str]:
    """Replace the Agents SDK runner; return the list of prompts it saw."""
    seen: list[str] = []
    result = FakeResult(findings or default_findings())

    class FakeRunner:
        @staticmethod
        async def run(agent, input: str):
            seen.append(input)
            return result

    monkeypatch.setattr(metered, "Runner", FakeRunner)
    return seen


def stub_exa(monkeypatch, pages: list[dict] | None) -> list[str]:
    """Stub Exa; return the list of queries it was asked for."""
    queries: list[str] = []

    async def fake_serp_pages(keyword: str, num_results: int = 8) -> list[dict]:
        queries.append(keyword)
        return list(pages or [])

    monkeypatch.setattr(exa, "serp_pages", fake_serp_pages)
    return queries


# ----------------------------------------------------------- pure functions


def test_queries_cover_publication_questions_and_audience():
    queries = trends.research_queries(make_niche())
    assert len(queries) == 3
    assert any("trending" in q for q in queries)
    assert any("questions people ask" in q for q in queries)
    assert any("beginners with an entry-level machine" in q for q in queries)


def test_a_niche_without_a_title_has_nothing_to_search_for():
    assert trends.research_queries(make_niche(title=" ")) == []


def test_the_audience_query_is_dropped_when_there_is_no_audience():
    assert len(trends.research_queries(make_niche(target_audience=""))) == 2


def test_prompt_carries_the_brief_and_the_do_not_repeat_list():
    prompt = trends.build_prompt(
        make_niche(), pages=make_pages(), recent_topics=["grind size basics"]
    )
    assert "Home espresso" in prompt
    assert "DO NOT REPEAT" in prompt
    assert "grind size basics" in prompt
    assert "example0.com" in prompt


def test_prompt_says_so_when_search_is_unavailable():
    """Told explicitly, so the model reports what it knows instead of
    dressing model knowledge up as if it had read something."""
    prompt = trends.build_prompt(make_niche(), pages=[], recent_topics=[])
    assert "none available" in prompt
    assert "SEARCH RESULTS\n" not in prompt


def test_excerpts_are_bounded_so_one_page_cannot_eat_the_context():
    page = make_pages(1)[0] | {"highlights": [], "excerpt": "x" * 5000}
    prompt = trends.build_prompt(make_niche(), pages=[page], recent_topics=[])
    assert "x" * trends.EXCERPT_CHARS in prompt
    assert "x" * (trends.EXCERPT_CHARS + 1) not in prompt


# ------------------------------------------------------------------ repair


def test_an_unknown_format_key_is_repaired_and_noted():
    """An angle naming a format that does not exist would raise at script
    time — long after the user approved the angle."""
    findings = trends.TrendFindings(
        angles=[trends.TrendAngle(title="a", format_key="documentry")]
    )
    fixed, notes = trends._normalize(findings)
    assert fixed.angles[0].format_key == registry.DEFAULT_FORMAT_KEY
    assert any("documentry" in n for n in notes)


def test_a_known_format_key_is_left_alone():
    findings = trends.TrendFindings(
        angles=[trends.TrendAngle(title="a", format_key="listicle")]
    )
    fixed, notes = trends._normalize(findings)
    assert fixed.angles[0].format_key == "listicle"
    assert notes == []


def test_over_long_hooks_are_flagged_but_kept():
    """Shortening someone's hook changes what the video is about, so this
    reports instead of editing."""
    long_hook = " ".join(["word"] * 20)
    findings = trends.TrendFindings(
        hooks=[trends.TrendHook(hook=long_hook, open_loop="?")]
    )
    fixed, notes = trends._normalize(findings)
    assert fixed.hooks[0].hook == long_hook
    assert any("3 seconds" in n for n in notes)


# --------------------------------------------------------------- gathering


async def test_sources_are_deduped_across_queries(monkeypatch):
    """Three queries against overlapping SERPs return the same URL more
    than once; a report that cites the same page three times looks like
    three sources."""
    stub_exa(monkeypatch, make_pages(1))
    pages, queries = await trends.gather_sources(make_niche())
    assert len(queries) == 3
    assert len(pages) == 1


async def test_source_count_is_capped(monkeypatch):
    stub_exa(monkeypatch, make_pages(20))
    pages, _ = await trends.gather_sources(make_niche())
    assert len(pages) == trends.MAX_SOURCES


# ------------------------------------------------------------- the full run


async def test_a_grounded_report_carries_the_pages_exa_returned(
    monkeypatch, fake_spend
):
    """Sources come from the search results, never from the model: an
    invented citation is worse than none."""
    spend, _ = fake_spend
    stub_exa(monkeypatch, make_pages(2))
    stub_runner(monkeypatch)

    report = await trends.research_trends(make_niche(), spend=spend)

    assert report.grounded is True
    assert [s.url for s in report.sources] == [
        "https://example0.com/post",
        "https://example1.com/post",
    ]
    assert report.themes and report.hooks and report.angles
    assert report.niche_title == "Home espresso"
    assert report.notes == []


async def test_research_degrades_to_model_knowledge_without_exa(monkeypatch, fake_spend):
    """Unconfigured Exa returns [] rather than raising; a report from
    model knowledge beats a failed run — but it must be labelled."""
    spend, _ = fake_spend
    stub_exa(monkeypatch, [])
    seen = stub_runner(monkeypatch)

    report = await trends.research_trends(make_niche(), spend=spend)

    assert report.grounded is False
    assert report.sources == []
    assert report.themes
    assert any("model knowledge" in n for n in report.notes)
    assert "none available" in seen[0]


async def test_the_llm_call_is_metered(monkeypatch, fake_spend):
    spend, recorder = fake_spend
    stub_exa(monkeypatch, make_pages(1))
    stub_runner(monkeypatch)

    await trends.research_trends(make_niche(), spend=spend)

    assert len(recorder.entries) == 1
    entry = recorder.entries[0]
    assert entry.provider == "openai"
    assert entry.sku == "llm:trend-research"
    assert entry.units == Decimal(1600)
    assert entry.cost_usd > 0


async def test_a_capped_niche_never_reaches_the_model(monkeypatch):
    """ensure_can_spend runs BEFORE the call, so a niche at its cap pays
    nothing for the attempt."""
    seen = stub_runner(monkeypatch)
    stub_exa(monkeypatch, [])

    async def no_spend(*, user_id: str, niche_id):
        return Decimal("0")

    async def record(entry):  # pragma: no cover - must never be reached
        raise AssertionError("logged spend after a refused call")

    spend = SpendContext(
        user_id="user_test",
        niche_id=NICHE_ID,
        job_id=uuid4(),
        record=record,
        cap_usd=Decimal("0.001"),
        today_spend=no_spend,
    )
    with pytest.raises(SpendCapExceeded):
        await trends.research_trends(make_niche(), spend=spend)
    assert seen == []


async def test_research_runs_unmetered_when_no_context_is_given(monkeypatch):
    """Evals and CLI dry runs pass spend=None; that must not crash."""
    stub_exa(monkeypatch, [])
    stub_runner(monkeypatch)
    report = await trends.research_trends(make_niche(), spend=None)
    assert report.themes


async def test_research_refuses_unbilled_before_exa(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "allow_unbilled_usage", False)

    async def explode(*_a, **_k):
        raise AssertionError("Exa must not run when unbilled usage is off")

    monkeypatch.setattr(exa, "serp_pages", explode)
    with pytest.raises(SpendCapExceeded, match="ALLOW_UNBILLED"):
        await trends.research_trends(make_niche(), spend=None)


# --------------------------------------------------------- the modal driver


class FakeReportsRepo:
    """In-memory stand-in for repos.trend_reports."""

    def __init__(self, row: dict | None) -> None:
        self.row = row
        self.calls: list[tuple] = []

    async def get(self, report_id, *, user_id):
        return self.row

    async def set_status(self, report_id, *, user_id, status):
        self.calls.append(("status", status))
        if self.row is not None:
            self.row["status"] = status
        return self.row

    async def complete(self, report_id, *, user_id, report, grounded):
        self.calls.append(("complete", grounded))
        self.row |= {"status": "done", "report": report, "grounded": grounded}
        return self.row

    async def fail(self, report_id, *, user_id, error):
        self.calls.append(("fail", error))
        self.row = (self.row or {}) | {"status": "failed", "error": error}
        return self.row


def stub_driver(monkeypatch, *, niche: Niche | None, row: dict | None) -> FakeReportsRepo:
    from marketer.repos import jobs as jobs_repo
    from marketer.repos import niches as niches_repo
    from marketer.repos import trend_reports as reports_repo
    from marketer.services import spend_context

    fake = FakeReportsRepo(row)
    for name in ("get", "set_status", "complete", "fail"):
        monkeypatch.setattr(reports_repo, name, getattr(fake, name))

    async def fake_niche_get(niche_id, *, user_id):
        return niche

    async def fake_recent(niche_id, *, user_id, limit=20):
        return ["already covered"]

    async def fake_default_context(**kw):
        return SpendContext(
            user_id=kw["user_id"],
            niche_id=kw["niche_id"],
            job_id=None,
            record=_swallow,
            cap_usd=None,
        )

    monkeypatch.setattr(niches_repo, "get", fake_niche_get)
    monkeypatch.setattr(jobs_repo, "recent_topics_for_niche", fake_recent)
    monkeypatch.setattr(spend_context, "default_context", fake_default_context)
    return fake


async def _swallow(entry):
    return None


def _row(report_id) -> dict:
    return {"id": report_id, "niche_id": NICHE_ID, "status": "queued", "report": {}}


async def test_the_driver_stores_a_finished_report(monkeypatch):
    report_id = uuid4()
    fake = stub_driver(monkeypatch, niche=make_niche(), row=_row(report_id))
    stub_exa(monkeypatch, make_pages(1))
    seen = stub_runner(monkeypatch)

    result = await trends.run_trend_research(user_id="user_test", report_id=report_id)

    assert result["status"] == "done"
    assert result["grounded"] is True
    assert result["report"]["hooks"][0]["hook"]
    assert ("status", "researching") in fake.calls
    # The do-not-repeat list is threaded through to the prompt.
    assert "already covered" in seen[0]


async def test_a_failed_run_lands_on_the_row(monkeypatch):
    """A report stranded in `researching` is invisible and un-retryable,
    so every failure has to be written down."""
    report_id = uuid4()
    fake = stub_driver(monkeypatch, niche=make_niche(), row=_row(report_id))
    stub_exa(monkeypatch, [])

    class BoomRunner:
        @staticmethod
        async def run(agent, input: str):
            raise RuntimeError("model exploded")

    monkeypatch.setattr(metered, "Runner", BoomRunner)

    result = await trends.run_trend_research(user_id="user_test", report_id=report_id)

    assert result["status"] == "failed"
    assert "model exploded" in result["error"]
    assert any(c[0] == "fail" for c in fake.calls)


async def test_a_missing_niche_fails_the_row_instead_of_raising(monkeypatch):
    report_id = uuid4()
    stub_driver(monkeypatch, niche=None, row=_row(report_id))
    result = await trends.run_trend_research(user_id="user_test", report_id=report_id)
    assert result["status"] == "failed"
    assert "niche not found" in result["error"]


async def test_a_missing_report_row_raises(monkeypatch):
    """Nothing to write the failure to, so this is a programming error,
    not a user-visible one."""
    stub_driver(monkeypatch, niche=make_niche(), row=None)
    with pytest.raises(ValueError, match="not found"):
        await trends.run_trend_research(user_id="user_test", report_id=uuid4())
