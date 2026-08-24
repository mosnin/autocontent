"""Export the marketer public API's OpenAPI schema to a committed JSON file.

Usage::

    uv run python scripts/export_openapi.py               # writes docs/api/openapi.json
    uv run python scripts/export_openapi.py --out path.json
    uv run python scripts/export_openapi.py --check        # exit 1 if the file is stale

This is the artifact the TypeScript SDK (``packages/ts-sdk``) generates
types from, and that the developer docs (``docs/api``) render against. It
is meant to be re-run whenever a route changes and the result committed,
so ``openapi.json`` diffs meaningfully in review.

Deliberately does NOT touch the database
-----------------------------------------
``backend.main.create_app()`` registers a ``lifespan`` handler
(``_run_boot_preflight``) that only runs when the app is actually served
(``uvicorn``, ``TestClient`` used as a context manager, etc.) — merely
constructing the ``FastAPI`` instance and reading ``app.openapi()`` never
triggers it, because FastAPI computes the schema by introspecting route
signatures/Pydantic models, not by executing route bodies or opening a DB
connection. This script relies on exactly that: it imports
``backend.main:create_app``, builds the app, and calls ``.openapi()`` —
nothing else — so it runs in CI/dev environments with no
``MARKETER_DATABASE_URL`` reachable.

Determinism
-----------
``backend.openapi.dump_openapi_json`` recursively sorts every dict's keys
before serializing, so two runs against the same route table produce
byte-identical output regardless of Python dict/set iteration order or
import order. ``customize_openapi(app)`` is applied here explicitly
(rather than relying on ``create_app()`` to have wired it — it may not
have yet, see ``backend/openapi.py``'s own docstring) so the exported
spec always has the Bearer security scheme, tag groups, and stable
operationIds regardless of what main.py currently does.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = REPO_ROOT / "docs" / "api" / "openapi.json"

# Run as a plain script (``uv run python scripts/export_openapi.py``), not as
# an installed console entry point, so ``backend`` (a top-level package that
# lives at the repo root, not under ``src/``) isn't necessarily importable
# via the default sys.path. Under pytest this works for free because pytest
# inserts the repo root itself (tests/__init__.py makes it walk up to the
# first package-less ancestor); do the equivalent here so the script behaves
# identically whether invoked directly or imported from a test module.
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def build_spec_json() -> str:
    """Construct the FastAPI app and render its OpenAPI schema as
    deterministic JSON text. Does not require a database connection."""
    from backend.main import create_app
    from backend.openapi import customize_openapi, dump_openapi_json

    app = create_app()
    customize_openapi(app)
    return dump_openapi_json(app)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help=f"output path for openapi.json (default: {DEFAULT_OUT.relative_to(REPO_ROOT)})",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="don't write; exit 1 if the file on disk differs from a fresh export",
    )
    args = parser.parse_args(argv)

    spec_json = build_spec_json()

    if args.check:
        existing = args.out.read_text() if args.out.exists() else None
        if existing != spec_json:
            print(f"{args.out} is stale — re-run without --check to update", file=sys.stderr)
            return 1
        print(f"{args.out} is up to date")
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(spec_json)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
