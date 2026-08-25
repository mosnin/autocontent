"""Ad Creative Studio — a public domain in, a bounded Ad Run of ads out.

Ported from "Branda". The domain vocabulary is preserved verbatim so the
two codebases can be reasoned about together:

* **Brand** — the organization whose public site supplies the identity.
* **Brief** — the normalized Brand facts + descriptive visual attributes
  used throughout one Ad Run.
* **Product** — a distinct offering fact-grounded in the Brand's site.
* **Creative Direction** — a named visual treatment with a dedicated
  prompt implementation (twelve of them, in `directions.py`).
* **Planned Concept** — one Creative Direction paired with fact-grounded
  copy, a company-or-Product subject, and an Image Model.
* **Ad Run** — three Company Planned Concepts followed by one to three
  Product Planned Concepts, generated together from one Brief.
* **Ad Slot** — the rendering lifecycle and result of one Planned Concept.
* **Rendered Ad** — the finished 1:1 raster produced for an Ad Slot.
* **Image Model** — a catalogued generator with a placement tier and a
  declared raster-logo capability.

Module map (mirrors Branda's):

* `policy.py`      Ad Run composition, ordering, and shared field limits.
* `directions.py`  the Creative Direction catalog.
* `models.py`      the Image Model catalog, tiers, assignment, prices.
* `colors.py`      hex -> HSL -> plain-English phrase; brand color picking.
* `domains.py`     canonicalization policy for user-supplied domains.
* `schemas.py`     the validated Ad Run contract (pydantic).
* `concepts.py`    the twelve prompt implementations.
* `brief.py`       homepage markdown -> summary, and the LLM planning call.
* `planner.py`     Brand research policy; produces validated Ad Run plans.
* `renderer.py`    Image Model retry, raster-logo downgrade, run fan-out.
"""
from __future__ import annotations
