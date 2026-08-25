"""Build config files must exist.

`web/postcss.config.mjs` is seven lines that register the Tailwind v4
plugin. Without it Next compiles and serves 200s, every route works, and
no test fails — but no CSS is generated at all, so the site renders as
unstyled serif text. It was deleted once by a careless `rm -f web/*.mjs`
and reached main, because nothing in the suite looked at it.

These files are small, load-bearing, and easy to delete by accident.
Asserting they exist is cheaper than the alternative.
"""
from __future__ import annotations

from pathlib import Path

import pytest

_WEB = Path(__file__).resolve().parent.parent / "web"

# path -> a string that must appear in it, so an empty or truncated file
# fails too rather than merely existing.
_REQUIRED = {
    "postcss.config.mjs": "@tailwindcss/postcss",
    "next.config.js": "nextConfig",
    "tsconfig.json": "compilerOptions",
    "package.json": '"next"',
}

pytestmark = pytest.mark.skipif(not _WEB.is_dir(), reason="web app not present")


@pytest.mark.parametrize(("name", "needle"), sorted(_REQUIRED.items()))
def test_build_config_exists_and_is_populated(name: str, needle: str) -> None:
    path = _WEB / name
    assert path.is_file(), f"web/{name} is missing — the web build cannot work without it"
    assert needle in path.read_text(), (
        f"web/{name} exists but does not contain {needle!r}; it looks truncated"
    )
