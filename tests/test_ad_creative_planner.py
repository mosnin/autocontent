"""Planner: research policy, partial-failure grading, and degradation.

Every Context.dev and OpenAI call is stubbed — the point of these tests
is the policy around the calls, not the vendors.
"""
from __future__ import annotations

import random
from types import SimpleNamespace

import pytest

from marketer.adcreative import brief as brief_mod
from marketer.adcreative import planner
from marketer.adcreative.brief import derive_summary_from_markdown, plan_concepts
from marketer.adcreative.planner import AdRunPlanningError, build_brief, parse_products
from marketer.adcreative.policy import AD_PRIMARY_MODEL_COUNT, company_count
from marketer.adcreative.schemas import AdRunPlan, Product
from marketer.services.context_dev import ContextDevUnavailable

_BRAND = {
    "name": "Stripe",
    "description": "Payments infrastructure for the internet.",
    "industries": ["fintech"],
    "logos": [{"url": "https://cdn.stripe.com/logo.png"}],
}
_STYLEGUIDE = {
    "mood": "modern, technical, trustworthy",
    "colors": [{"hex": "#543cfc", "name": "Brand"}, "#0a1f44", "not-a-color"],
    "typography": {"fontFamily": "Sohne"},
}
_MARKDOWN = (
    "# Stripe\n"
    "[Sign up](https://stripe.com/signup)\n"
    "Stripe is a technology company that builds economic infrastructure "
    "for the internet. Businesses of every size use our software to accept "
    "payments and manage their businesses online.\n"
    "Get started today\n"
    "300% faster payouts\n"
)
_PRODUCTS = [
    Product(name="Payments", description="Accept payments online."),
    Product(name="Radar", description="Machine-learning fraud detection."),
]


@pytest.fixture(autouse=True)
def _enable_feature(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "ad_creative_enabled", True)
    monkeypatch.setattr(settings, "context_dev_api_key", "ctx-test")
    yield


def _stub_research(
    monkeypatch,
    *,
    brand=_BRAND,
    markdown=_MARKDOWN,
    styleguide=_STYLEGUIDE,
    products=None,
):
    async def _maybe(value):
        if isinstance(value, BaseException):
            raise value
        return value

    async def _brand(domain):
        return await _maybe(brand)

    async def _markdown(url, **kwargs):
        return await _maybe(markdown)

    async def _styleguide(domain):
        return await _maybe(styleguide)

    async def _products(domain):
        return await _maybe(
            products if products is not None else list(_PRODUCTS)
        )

    monkeypatch.setattr(planner.context_dev, "retrieve_brand", _brand)
    monkeypatch.setattr(planner.context_dev, "scrape_markdown", _markdown)
    monkeypatch.setattr(planner.context_dev, "extract_styleguide", _styleguide)
    monkeypatch.setattr(planner, "_research_products", _products)


def _stub_planner_llm(monkeypatch, picks=None, *, boom: Exception | None = None):
    """Replace the one LLM call. `boom` exercises the degradation path."""

    async def _call(brief, products, *, spend):
        if boom is not None:
            raise boom
        return picks

    monkeypatch.setattr(brief_mod, "_call_planner", _call)


def _picks(company_keys, product_keys):
    return brief_mod._PlanResponse(
        company_picks=[
            brief_mod._CopyPick(concept=k, headline=f"Head {i}", subheadline="Sub line")
            for i, k in enumerate(company_keys)
        ],
        product_picks=[
            brief_mod._CopyPick(concept=k, headline=f"Prod {i}", subheadline="Sub line")
            for i, k in enumerate(product_keys)
        ],
    )


# ── summary derivation ────────────────────────────────────────────────────


def test_summary_keeps_prose_and_drops_chrome():
    summary = derive_summary_from_markdown(_MARKDOWN)
    assert summary.startswith("Stripe is a technology company")
    assert "Sign up" not in summary
    assert "300%" not in summary
    assert "#" not in summary


def test_summary_of_empty_markdown_is_empty():
    assert derive_summary_from_markdown("") == ""
    assert derive_summary_from_markdown("# Heading only\n- bullet\n") == ""


# ── brief assembly ────────────────────────────────────────────────────────


def test_build_brief_normalizes_everything_a_prompt_sees():
    brief = build_brief("stripe.com", _BRAND, _MARKDOWN, _STYLEGUIDE)
    assert brief.brand_name == "Stripe"
    assert brief.industry == "fintech"
    assert brief.mood == "modern, technical, trustworthy"
    assert brief.font_family == "Sohne"
    assert brief.logo_url == "https://cdn.stripe.com/logo.png"
    # Palette keeps hex for the UI; prompt colors are phrases only.
    assert [c.hex for c in brief.colors] == ["#543cfc", "#0a1f44"]
    assert not brief.color_a.startswith("#")
    assert not brief.color_b.startswith("#")


def test_build_brief_defaults_when_styleguide_is_empty():
    brief = build_brief("stripe.com", _BRAND, "", {})
    assert brief.mood == planner.DEFAULT_MOOD
    assert brief.colors == []
    assert brief.font_family is None
    assert brief.color_a and brief.color_b


def test_build_brief_falls_back_to_the_domain_for_a_nameless_brand():
    assert build_brief("stripe.com", {}, "", {}).brand_name == "stripe.com"


def test_build_brief_drops_a_private_logo_url():
    brand = {"name": "X", "logoUrl": "http://169.254.169.254/logo.png"}
    assert build_brief("x.com", brand, "", {}).logo_url is None


# ── product extraction ────────────────────────────────────────────────────


def test_parse_products_dedupes_and_bounds():
    payload = {
        "products": [
            {"name": "Payments", "description": "Accept payments."},
            {"name": "payments", "description": "Duplicate offering."},
            {"name": "Radar", "description": "Fraud detection."},
            {"name": "", "description": "No name."},
            {"name": "Billing", "description": "Subscriptions."},
            {"name": "Terminal", "description": "In person."},
            "junk",
        ]
    }
    products = parse_products(payload)
    assert [p.name for p in products] == ["Payments", "Radar", "Billing"]


def test_parse_products_tolerates_nonsense():
    assert parse_products(None) == []
    assert parse_products({"products": "nope"}) == []


# ── partial-failure policy ────────────────────────────────────────────────


async def test_plan_ad_run_happy_path(monkeypatch):
    _stub_research(monkeypatch)
    _stub_planner_llm(
        monkeypatch,
        _picks(["isometric", "gradient_field", "typographic"], ["product_hero", "collage"]),
    )
    plan = await planner.plan_ad_run("https://www.stripe.com/pricing")
    assert isinstance(plan, AdRunPlan)
    assert plan.brief.domain == "stripe.com"
    assert len(plan.concepts) == company_count() + len(_PRODUCTS)
    assert [c.subject.kind for c in plan.concepts[: company_count()]] == ["company"] * 3
    assert [c.subject.name for c in plan.concepts[company_count() :]] == [
        "Payments",
        "Radar",
    ]


async def test_invalid_domain_is_refused_before_any_research(monkeypatch):
    called: list[str] = []

    async def _boom(*a, **k):
        called.append("x")
        raise AssertionError("must not research a rejected domain")

    monkeypatch.setattr(planner.context_dev, "retrieve_brand", _boom)
    with pytest.raises(AdRunPlanningError) as exc:
        await planner.plan_ad_run("localhost")
    assert exc.value.code == "invalid-domain"
    assert called == []


async def test_disabled_feature_is_not_configured(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "ad_creative_enabled", False)
    with pytest.raises(AdRunPlanningError) as exc:
        await planner.plan_ad_run("stripe.com")
    assert exc.value.code == "not-configured"


async def test_missing_context_dev_key_is_not_configured(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "context_dev_api_key", "")
    with pytest.raises(AdRunPlanningError) as exc:
        await planner.plan_ad_run("stripe.com")
    assert exc.value.code == "not-configured"


async def test_brand_and_page_both_failing_is_domain_unreachable(monkeypatch):
    _stub_research(
        monkeypatch,
        brand=ContextDevUnavailable("404", status=404),
        markdown=ContextDevUnavailable("404", status=404),
    )
    with pytest.raises(AdRunPlanningError) as exc:
        await planner.plan_ad_run("stripe.com")
    assert exc.value.code == "domain-unreachable"


async def test_brand_alone_failing_is_brand_unavailable(monkeypatch):
    _stub_research(monkeypatch, brand=ContextDevUnavailable("no brand"))
    with pytest.raises(AdRunPlanningError) as exc:
        await planner.plan_ad_run("stripe.com")
    assert exc.value.code == "brand-unavailable"


async def test_product_failure_is_products_unavailable(monkeypatch):
    _stub_research(monkeypatch, products=ContextDevUnavailable("extract failed"))
    with pytest.raises(AdRunPlanningError) as exc:
        await planner.plan_ad_run("stripe.com")
    assert exc.value.code == "products-unavailable"


async def test_too_few_products_is_products_unavailable(monkeypatch):
    _stub_research(monkeypatch, products=[])
    with pytest.raises(AdRunPlanningError) as exc:
        await planner.plan_ad_run("stripe.com")
    assert exc.value.code == "products-unavailable"


async def test_styleguide_failure_is_tolerated(monkeypatch):
    """A missing styleguide costs polish, not the run."""
    _stub_research(monkeypatch, styleguide=ContextDevUnavailable("no styleguide"))
    _stub_planner_llm(
        monkeypatch,
        _picks(["isometric", "gradient_field", "typographic"], ["product_hero", "collage"]),
    )
    plan = await planner.plan_ad_run("stripe.com")
    assert plan.brief.mood == planner.DEFAULT_MOOD
    assert plan.brief.colors == []


async def test_page_failure_alone_is_tolerated(monkeypatch):
    _stub_research(monkeypatch, markdown=ContextDevUnavailable("scrape failed"))
    _stub_planner_llm(
        monkeypatch,
        _picks(["isometric", "gradient_field", "typographic"], ["product_hero", "collage"]),
    )
    plan = await planner.plan_ad_run("stripe.com")
    assert plan.brief.summary == ""


# ── concept planning + degradation ────────────────────────────────────────


async def test_every_concept_gets_a_distinct_direction_and_model(monkeypatch):
    _stub_planner_llm(
        monkeypatch,
        _picks(["isometric", "gradient_field", "typographic"], ["product_hero", "collage"]),
    )
    brief = build_brief("stripe.com", _BRAND, _MARKDOWN, _STYLEGUIDE)
    concepts = await plan_concepts(brief, _PRODUCTS, rng=random.Random(1))
    assert len({c.key for c in concepts}) == len(concepts)
    assert len({c.model for c in concepts}) == len(concepts)
    # Company slots take primary models, product slots secondary.
    from marketer.adcreative.models import image_model_by_id

    for index, concept in enumerate(concepts):
        tier = "primary" if index < AD_PRIMARY_MODEL_COUNT else "secondary"
        assert image_model_by_id(concept.model).tier == tier


async def test_failed_planning_call_still_produces_a_valid_run(monkeypatch):
    """The degradation contract: research already cost money, so a dead
    LLM must yield grounded copy, not a lost Ad Run."""
    _stub_planner_llm(monkeypatch, boom=RuntimeError("planner exploded"))
    brief = build_brief("stripe.com", _BRAND, _MARKDOWN, _STYLEGUIDE)
    concepts = await plan_concepts(brief, _PRODUCTS, rng=random.Random(3))
    AdRunPlan(brief=brief, concepts=concepts)  # full contract validation
    assert concepts[0].headline == "Stripe"
    assert concepts[company_count()].headline == "Payments"
    assert len({c.key for c in concepts}) == len(concepts)


async def test_duplicate_direction_picks_are_replaced_not_repeated(monkeypatch):
    _stub_planner_llm(
        monkeypatch,
        _picks(["isometric", "isometric", "isometric"], ["isometric", "isometric"]),
    )
    brief = build_brief("stripe.com", _BRAND, _MARKDOWN, _STYLEGUIDE)
    concepts = await plan_concepts(brief, _PRODUCTS, rng=random.Random(5))
    assert len({c.key for c in concepts}) == len(concepts)


async def test_unknown_direction_from_the_model_is_discarded(monkeypatch):
    _stub_planner_llm(
        monkeypatch,
        _picks(["hallucinated", "gradient_field", "typographic"], ["product_hero", "collage"]),
    )
    brief = build_brief("stripe.com", _BRAND, _MARKDOWN, _STYLEGUIDE)
    concepts = await plan_concepts(brief, _PRODUCTS, rng=random.Random(9))
    assert "hallucinated" not in {c.key for c in concepts}
    AdRunPlan(brief=brief, concepts=concepts)


async def test_overlong_copy_is_clamped_to_poster_size(monkeypatch):
    picks = _picks(["isometric", "gradient_field", "typographic"], ["product_hero", "collage"])
    picks.company_picks[0].headline = "one two three four five six"
    picks.company_picks[0].subheadline = " ".join(f"w{i}" for i in range(40))
    _stub_planner_llm(monkeypatch, picks)
    brief = build_brief("stripe.com", _BRAND, _MARKDOWN, _STYLEGUIDE)
    concepts = await plan_concepts(brief, _PRODUCTS, rng=random.Random(2))
    assert concepts[0].headline == "one two three"
    assert len(concepts[0].subheadline.split()) == 12


async def test_product_count_outside_policy_raises(monkeypatch):
    _stub_planner_llm(monkeypatch, _picks([], []))
    brief = build_brief("stripe.com", _BRAND, _MARKDOWN, _STYLEGUIDE)
    with pytest.raises(ValueError):
        await plan_concepts(brief, [], rng=random.Random(1))


async def test_planning_call_is_metered(monkeypatch, fake_spend):
    """One LLM call, one pre-flight check, one ledger row."""
    spend, recorder = fake_spend
    checked: list[object] = []

    async def _ensure(amount):
        checked.append(amount)

    monkeypatch.setattr(spend, "ensure_can_spend", _ensure)

    class _FakeCompletions:
        async def parse(self, **kwargs):
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            parsed=_picks(
                                ["isometric", "gradient_field", "typographic"],
                                ["product_hero", "collage"],
                            )
                        )
                    )
                ],
                usage=SimpleNamespace(prompt_tokens=1200, completion_tokens=300),
            )

    class _FakeClient:
        def __init__(self, **kwargs):
            self.beta = SimpleNamespace(chat=SimpleNamespace(completions=_FakeCompletions()))

    import openai

    monkeypatch.setattr(openai, "AsyncOpenAI", _FakeClient)
    brief = build_brief("stripe.com", _BRAND, _MARKDOWN, _STYLEGUIDE)
    await plan_concepts(brief, _PRODUCTS, spend=spend, rng=random.Random(1))

    assert len(checked) == 1
    assert len(recorder.entries) == 1
    entry = recorder.entries[0]
    assert entry.provider == "openai"
    assert entry.sku.startswith("llm:")
    assert entry.units == 1500
    assert entry.cost_usd > 0


async def test_spend_cap_aborts_instead_of_degrading(monkeypatch, fake_spend):
    """A cap trip must not be swallowed by the fallback path — continuing
    to render after the cap said stop is the opposite of degrading."""
    from marketer.repos.spend import SpendCapExceeded

    spend, _ = fake_spend
    _stub_planner_llm(monkeypatch, boom=SpendCapExceeded("cap", scope="niche"))
    brief = build_brief("stripe.com", _BRAND, _MARKDOWN, _STYLEGUIDE)
    with pytest.raises(SpendCapExceeded):
        await plan_concepts(brief, _PRODUCTS, spend=spend, rng=random.Random(1))
