"""There must be exactly one UI component kit.

This repo shipped two for a while — `components/ui/` (ark-ui +
tailwind-variants) and `components/square/ui/` (radix + cva) — with 15
duplicated primitives between them. App pages imported from both, often
in the same file. Two consequences, and the second is the expensive one:

1. No design decision could be made once. Restyling a button meant
   editing two buttons, and any drift between them was invisible.
2. The two `Checkbox`es had DIFFERENT change contracts — radix passed a
   bare boolean, ark passes `{ checked }`. Six call sites read
   `!!value`, which is `true` for any object. TypeScript accepts that
   happily, so consolidating the kits was what finally exposed
   checkboxes that could never be unchecked.

These tests are the cheap guard against a third kit appearing, or the
second one growing back. They live in the Python suite because that is
what CI already runs; the web package has no test runner.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

_REPO = Path(__file__).resolve().parent.parent
_WEB = _REPO / "web"
_COMPONENTS = _WEB / "components"
_CANONICAL = "components/ui"

pytestmark = pytest.mark.skipif(not _COMPONENTS.is_dir(), reason="web app not present")


def _tsx_sources() -> list[tuple[Path, str]]:
    return [
        (path, path.read_text())
        for path in _WEB.rglob("*.tsx")
        if "node_modules" not in path.parts
    ]


def test_only_one_component_kit_exists() -> None:
    """A directory named `ui` anywhere but `components/ui` is a second kit.

    Nested kits are how this happened the first time: a template was
    vendored wholesale, `ui` folder and all, and nothing objected.
    """
    kits = {
        path.parent.relative_to(_WEB).as_posix()
        for path in _WEB.rglob("ui/*.tsx")
        if "node_modules" not in path.parts
    }
    assert kits == {_CANONICAL}, (
        f"expected exactly one component kit at {_CANONICAL}, found: {sorted(kits)}"
    )


def test_nothing_imports_a_non_canonical_kit() -> None:
    offenders = sorted(
        {
            path.relative_to(_WEB).as_posix()
            for path, source in _tsx_sources()
            # Any `@/components/<something>/ui/...` other than the canonical one.
            if re.search(r'@/components/(?!ui/)[\w-]+/ui/', source)
        }
    )
    assert not offenders, (
        "these files import a component kit other than "
        f"@/{_CANONICAL}: {offenders}"
    )


def test_checkbox_handlers_use_the_ark_contract() -> None:
    """`!!value` on ark's `{ checked }` detail object is always true.

    That is not a style nit: it silently produces a checkbox that cannot
    be unchecked, and neither TypeScript nor a render test notices.

    Scoped to files importing the ark `Checkbox`. Radix-derived controls
    that share the prop name — `Switch`, `DropdownMenuCheckboxItem` —
    really do pass a bare boolean, so `!!v` is correct there and flagging
    it would teach people to silence this test.
    """
    offenders = sorted(
        {
            path.relative_to(_WEB).as_posix()
            for path, source in _tsx_sources()
            if "@/components/ui/checkbox" in source
            and re.search(r"onCheckedChange=\{\([\w]+\) =>[^}]*!!", source)
        }
    )
    assert not offenders, (
        "these files coerce the checkbox change detail with `!!`, which is "
        f"always true for an object — read `.checked` instead: {offenders}"
    )
