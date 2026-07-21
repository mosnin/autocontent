"""Tests for scripts/export_openapi.py.

Asserts the export script produces a valid, deterministic OpenAPI 3.x
document (paths / info / security scheme all present) without needing a
reachable database — constructing the app and reading ``.openapi()``
must not touch Postgres.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.export_openapi import build_spec_json, main  # noqa: E402


def test_build_spec_json_is_valid_openapi_document():
    spec = json.loads(build_spec_json())

    assert spec["openapi"].startswith("3.")
    assert spec["info"]["title"]
    assert spec["info"]["version"]

    assert isinstance(spec["paths"], dict)
    assert len(spec["paths"]) > 0

    # A handful of routes this team's docs/examples rely on must be present.
    assert "/api/v1/niches" in spec["paths"]
    assert "/api/v1/jobs" in spec["paths"]

    security_schemes = spec["components"]["securitySchemes"]
    assert "BearerAuth" in security_schemes
    assert security_schemes["BearerAuth"]["type"] == "http"
    assert security_schemes["BearerAuth"]["scheme"] == "bearer"
    assert spec["security"] == [{"BearerAuth": []}]


def test_build_spec_json_is_deterministic_across_runs():
    first = build_spec_json()
    second = build_spec_json()
    assert first == second


def test_build_spec_json_keys_are_recursively_sorted():
    spec = json.loads(build_spec_json())

    def assert_sorted(value: object) -> None:
        if isinstance(value, dict):
            keys = list(value.keys())
            assert keys == sorted(keys)
            for v in value.values():
                assert_sorted(v)
        elif isinstance(value, list):
            for v in value:
                assert_sorted(v)

    assert_sorted(spec)


def test_main_writes_file_and_check_mode_agrees(tmp_path):
    out_path = tmp_path / "openapi.json"

    exit_code = main(["--out", str(out_path)])
    assert exit_code == 0
    assert out_path.exists()

    written = out_path.read_text()
    assert written == build_spec_json()

    # --check should pass (exit 0) against the file we just wrote.
    assert main(["--out", str(out_path), "--check"]) == 0


def test_main_check_mode_detects_staleness(tmp_path):
    out_path = tmp_path / "openapi.json"
    out_path.write_text('{"stale": true}\n')

    assert main(["--out", str(out_path), "--check"]) == 1
