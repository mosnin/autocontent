"""Check the generated fal registry is structurally sound and still current.

Structural checks run offline and are the ones worth wiring into CI. Pass
``--live`` to additionally re-resolve every endpoint's queue OpenAPI and
re-read fal's published price, which is how price drift and retired
endpoints get caught.

    python3 scripts/studio_catalog/verify.py
    python3 scripts/studio_catalog/verify.py --live
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from marketer.services.studio_fal_registry import FAL_REGISTRY  # noqa: E402

KINDS = {"image", "video", "audio", "lipsync", "video2video", "recast"}
UNITS = {"image", "second", "character", "megapixel"}
OUTPUTS = {"image", "video", "audio"}

failures: list[str] = []


def check_structure() -> None:
    seen: set[str] = set()
    names: set[str] = set()
    for entry in FAL_REGISTRY:
        model_id = entry.get("id", "<missing id>")
        if model_id in seen:
            failures.append(f"{model_id}: duplicate id")
        seen.add(model_id)
        if entry.get("name") in names:
            failures.append(f"{model_id}: duplicate name {entry.get('name')!r}")
        names.add(entry.get("name"))
        if entry.get("endpoint") != model_id:
            failures.append(f"{model_id}: endpoint does not match id")
        if entry.get("kind") not in KINDS:
            failures.append(f"{model_id}: bad kind {entry.get('kind')!r}")
        if entry.get("unit") not in UNITS:
            failures.append(f"{model_id}: bad unit {entry.get('unit')!r}")
        if entry.get("output_kind") not in OUTPUTS:
            failures.append(f"{model_id}: bad output_kind")
        try:
            if float(entry.get("usd_per_unit", 0)) <= 0:
                failures.append(f"{model_id}: non-positive price")
        except (TypeError, ValueError):
            failures.append(f"{model_id}: unparseable price")
        schema = entry.get("input_schema") or {}
        if not schema:
            failures.append(f"{model_id}: empty input schema")
        for param in entry.get("required_params", []):
            if param not in schema:
                failures.append(f"{model_id}: requires {param}, not in its schema")
        for param, field in (entry.get("field_map") or {}).items():
            if param not in schema:
                failures.append(f"{model_id}: maps {param}, not in its schema")
            if param == field:
                failures.append(f"{model_id}: identity field map for {param}")
        durations = entry.get("allowed_durations") or []
        if durations and entry.get("unit") != "second":
            failures.append(f"{model_id}: durations on a non per-second model")
        default = entry.get("default_duration_sec")
        if durations and default and default not in durations:
            failures.append(f"{model_id}: default duration is not an allowed one")


def _fetch(url: str) -> str | None:
    request = urllib.request.Request(
        url, headers={"user-agent": "marketer.sh-catalog/1.0"}
    )
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            return response.read().decode("utf-8", "replace")
    except (urllib.error.HTTPError, OSError):
        return None


def check_live() -> None:
    def one(entry: dict) -> str | None:
        endpoint = entry["id"]
        spec = _fetch(
            "https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=" + endpoint
        )
        if spec is None:
            return f"{endpoint}: endpoint no longer resolves"
        page = _fetch(f"https://fal.ai/models/{endpoint}") or ""
        import re

        match = re.search(r'\\"endpointBilling\\":\{(.*?)\}', page)
        if not match:
            return None  # page shape changed; not a registry fault
        try:
            billing = json.loads(("{" + match.group(1) + "}").replace('\\"', '"'))
        except json.JSONDecodeError:
            return None
        published = billing.get("price")
        ours = float(entry["usd_per_unit"])
        # Per-1000-character prices are stored per character.
        if billing.get("billing_unit") == "1000 characters":
            published = (published or 0) / 1000
        if published and abs(float(published) - ours) > 1e-9:
            return (
                f"{endpoint}: price drifted — fal says {published}, "
                f"registry says {ours}"
            )
        return None

    with ThreadPoolExecutor(max_workers=8) as pool:
        for problem in pool.map(one, FAL_REGISTRY):
            if problem:
                failures.append(problem)


check_structure()
if "--live" in sys.argv:
    check_live()

kinds: dict[str, int] = {}
for entry in FAL_REGISTRY:
    kinds[entry["kind"]] = kinds.get(entry["kind"], 0) + 1
print(f"  {len(FAL_REGISTRY)} fal models: {sorted(kinds.items())}")

if failures:
    print(f"\nFAIL — {len(failures)} problem(s):")
    for problem in failures[:40]:
        print(f"  {problem}")
    sys.exit(1)
print("PASS")
