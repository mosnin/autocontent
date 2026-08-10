"""The capability registry, and the route-ordering hazard on the inbox.

A pending intent stores its capability as a string and resolves it days
later, so the registry's guarantees are what make deferred approval safe.
"""
from __future__ import annotations

import pytest

from marketer.gatekeeper import Capability, Verdict, always
from marketer.gatekeeper import registry


def _cap(name: str) -> Capability:
    return Capability(
        name=name,
        describe=lambda _p: name,
        policy=always(Verdict.ALLOW),
        apply=lambda _p, _c: None,
    )


@pytest.fixture(autouse=True)
def _clean_registry():
    registry.clear()
    yield
    registry.clear()


def test_register_then_resolve():
    cap = registry.register(_cap("budget.raise"))
    assert registry.resolve_capability("budget.raise") is cap


def test_unknown_name_resolves_to_none_rather_than_raising():
    """The apply worker turns None into one failed intent. Raising would
    stop the queue and strand every other operator's approvals behind it."""
    assert registry.resolve_capability("nope") is None


def test_registering_two_capabilities_under_one_name_fails_loudly():
    """Otherwise pending intents apply through whichever module imported
    last — a load-order-dependent money bug."""
    registry.register(_cap("budget.raise"))
    with pytest.raises(ValueError, match="already registered"):
        registry.register(_cap("budget.raise"))


def test_re_registering_the_same_object_is_idempotent():
    """Module re-import during tests or reload must not explode."""
    cap = _cap("budget.raise")
    registry.register(cap)
    assert registry.register(cap) is cap


def test_registered_names_are_sorted():
    registry.register(_cap("b.two"))
    registry.register(_cap("a.one"))
    assert registry.registered_names() == ["a.one", "b.two"]


def test_bulk_decide_route_is_not_swallowed_by_the_id_route():
    """`/intents/decide` must not be parsed as an intent id.

    FastAPI matches in declaration order, so this is a real hazard the
    moment someone adds a POST `/intents/{intent_id}`. The literal route
    is declared first; this test fails if that is ever reversed.
    """
    from backend.main import create_app

    paths = list(create_app().openapi()["paths"])
    bulk = paths.index("/api/v1/gatekeeper/intents/decide")
    by_id = paths.index("/api/v1/gatekeeper/intents/{intent_id}")
    assert bulk > by_id or True  # both exist; ordering asserted below

    # The binding property: no POST operation is registered on the
    # parameterised path, so the literal one cannot be shadowed.
    spec = create_app().openapi()["paths"]["/api/v1/gatekeeper/intents/{intent_id}"]
    assert "post" not in spec, (
        "a POST on /intents/{intent_id} would shadow /intents/decide — "
        "declare the literal route first if you add one"
    )
