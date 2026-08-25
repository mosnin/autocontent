"""Per-model UGC render cost, in USD, from duration + resolution.

Why the prices are PINNED here
------------------------------
Same reason `services/fal_video.py` pins a per-second registry: metering
has to know what a render costs *before* it is submitted, so that
`SpendContext.ensure_can_spend` can refuse it against the niche cap, the
global daily cap, and prepaid credit. MUAPI's submit response does not
carry a price, and the completion webhook doesn't either, so there is no
runtime source of truth to read — a pinned table is the only way to gate
spend at the moment it matters. The table is per *rendered second* and
matches the providers' published unit prices at integration time; when a
provider moves its prices these constants must be edited (and the diff is
reviewable, which is the other half of the point).

Why NOT the source's numbers
----------------------------
The Open AI UGC studio charges in its own scrip ("credits"), computed in
`src/app/api/generate/route.js`:

    grok-video   : duration * (10 if 720p else 5)
    veo-3-1      : duration * (500 | 650 @1080p | 740 @4k)
    happy-horse  : duration * 36
    seedance-2   : duration * 50

Those rates are internally inconsistent as a USD map (a Veo render costs
4000 credits while every new account is granted 10, so no free user can
ever render), and this product does not have — and per the port brief
must not grow — a second credit currency: `spend_ledger` + prepaid
credits is the single source of truth. So the absolute USD rates below
come from the providers' published prices, cross-checked against the
comparable models already pinned in our fal registry, and only the
*within-model resolution premium* is carried over from the source, where
the ratio is meaningful because it is the same model on the same gateway:

    grok  480p:720p = 5:10        -> 1.0x : 2.0x
    veo   720p:1080p:4k = 500:650:740 -> 1.0x : 1.3x : 1.48x

Seedance 2.5 is NOT priced here
-------------------------------
Those four routes are priced by `services/seedance.py`, which pins the
per-second rate per resolution tier and also carries the operator's
`MARKETER_SEEDANCE_PRICE_OVERRIDES` escape hatch. This module DELEGATES
to it instead of keeping a second copy: two price tables for one model
drift the moment one of them is edited, and a stale copy here would be
charged against the caller's cap while the gateway billed the real
number — a silent COGS bug rather than a loud failure.
"""
from __future__ import annotations

from decimal import Decimal

from ..services import seedance
from .catalog import UgcModel, require_model

# USD per rendered second. A model with a resolution knob keys by
# resolution; one without uses the "" key.
USD_PER_SECOND: dict[str, dict[str, Decimal]] = {
    # xAI grok-imagine-video is $0.050/s (see services/xai_pricing.py);
    # 720p doubles it, per the source's 5 -> 10 credit step.
    "grok-video": {
        "480p": Decimal("0.05"),
        "720p": Decimal("0.10"),
    },
    # Veo 3 renders at $0.40/s in our fal registry; the 1080p/4k premiums
    # are the source's 650/740-over-500 credit ratios.
    "veo-3-1": {
        "720p": Decimal("0.40"),
        "1080p": Decimal("0.52"),
        "4k": Decimal("0.592"),
    },
    # No resolution knob (720p is baked into the endpoint). Priced with
    # Pixverse V5 ($0.06/s), the comparable fast/stylized model.
    "happy-horse": {"": Decimal("0.06")},
    # No resolution knob. Priced with Sora 2 / Veo 3 Fast ($0.10/s), the
    # comparable multi-shot models.
    "seedance-2": {"": Decimal("0.10")},
}

_QUANTUM = Decimal("0.0001")


class UgcPricingError(RuntimeError):
    """No pinned price for this model/resolution — refuse to render.

    Rendering at an unknown price would put an unmetered charge on the
    operator's MUAPI account, so this fails closed rather than defaulting
    to zero.
    """


def _seedance_usd_per_second(model: UgcModel, resolution: str) -> Decimal:
    """Delegate to the provider adapter's pinned registry.

    Its failure modes are re-raised as `UgcPricingError` so every caller
    in the studio keeps one exception to catch, and an unpriced tier
    still fails closed rather than costing zero.
    """
    try:
        route = seedance.require_model(model.id)
        return seedance.usd_per_second(route, resolution or route.default_resolution)
    except (seedance.SeedancePricingError, seedance.SeedanceValidationError) as exc:
        raise UgcPricingError(str(exc)) from exc


def usd_per_second(model: UgcModel, resolution: str = "") -> Decimal:
    if model.adapter == "seedance":
        return _seedance_usd_per_second(model, resolution)
    table = USD_PER_SECOND.get(model.id)
    if not table:
        raise UgcPricingError(f"no pinned price for model {model.id!r}")
    key = resolution if model.resolutions else ""
    price = table.get(key)
    if price is None:
        raise UgcPricingError(f"no pinned price for {model.id!r} at resolution {resolution!r}")
    return price


def render_cost(model: UgcModel, *, duration: float, resolution: str = "") -> Decimal:
    """Cost of one render of `duration` seconds at `resolution`."""
    return (usd_per_second(model, resolution) * Decimal(str(duration))).quantize(_QUANTUM)


def estimate_cost(model_id: str, *, duration: float, resolution: str = "") -> Decimal:
    """`render_cost` by model id — the form the route and repo use."""
    return render_cost(require_model(model_id), duration=duration, resolution=resolution)


def cost_basis(model: UgcModel) -> dict:
    """The per-second rate card for one model, for `GET /ugc/models`.

    The UI multiplies this by the chosen duration to show a live estimate,
    so the number the user sees is the same number metering will charge.
    """
    if model.adapter == "seedance":
        # Already {"unit": "usd_per_second", "by_resolution": {...}} and
        # override-applied, so the quoted rate is the metered rate.
        return seedance.cost_basis(seedance.require_model(model.id))
    table = USD_PER_SECOND.get(model.id, {})
    if model.resolutions:
        return {
            "unit": "usd_per_second",
            "by_resolution": {res: str(table.get(res, "")) for res in model.resolutions},
        }
    return {"unit": "usd_per_second", "flat": str(table.get("", ""))}
