"""The Next.js media manager writes global public assets.

POST/DELETE were documented as admin-only but only checked that *any*
Clerk session existed. Any signed-in user could therefore replace the
marketing hero and dashboard images. The role lives in the API DB (not a
JWT claim), so the route must call requireAdmin() which confirms
users.role == 'admin' and fail-closes otherwise.
"""
from __future__ import annotations

from pathlib import Path

_REPO = Path(__file__).resolve().parent.parent
_ROUTE = _REPO / "web" / "app" / "api" / "media" / "route.ts"
_FILE_ROUTE = _REPO / "web" / "app" / "api" / "media" / "file" / "[id]" / "route.ts"
_HELPER = _REPO / "web" / "lib" / "require-admin.ts"


def test_media_mutations_use_require_admin_not_any_session() -> None:
    source = _ROUTE.read_text()
    assert 'from "@/lib/require-admin"' in source
    assert "requireAdmin()" in source
    assert "requireUser" not in source
    post = source.index("export async function POST")
    delete = source.index("export async function DELETE")
    assert "requireAdmin()" in source[post : post + 400]
    assert "requireAdmin()" in source[delete : delete + 400]
    assert "gate.status" in source


def test_media_manifest_get_stays_public() -> None:
    """Pages read the slot map without a session; only writes are gated."""
    source = _ROUTE.read_text()
    get = source.index("export async function GET")
    post = source.index("export async function POST")
    assert "requireAdmin" not in source[get:post]


def test_media_file_bytes_are_public_reads() -> None:
    source = _FILE_ROUTE.read_text()
    assert "requireAdmin" not in source
    assert "export async function GET" in source
    assert "export async function POST" not in source
    assert "export async function DELETE" not in source


def test_require_admin_checks_api_db_role_and_fail_closes() -> None:
    source = _HELPER.read_text()
    assert 'api<{ role?: string }>("/api/v1/users/me")' in source
    assert 'me.role !== "admin"' in source
    assert "status: 401" in source
    assert "status: 403" in source
    assert "return { ok: false, status: 403 }" in source
    assert "publicMetadata" not in source
    assert "orgRole" not in source
    # Session without a confirmable admin role must not grant the write.
    assert "catch" in source
