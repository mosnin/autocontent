"""Phase-4 hardening fixes (security + automation audit findings).

- X-Forwarded-For trusted-hop resolution (rate-limit identity can't be forged)
- SSRF guard for outbound webhook URLs
- admin-audit coverage on template mutations
"""
from __future__ import annotations

from starlette.requests import Request


def _req(xff: str | None = None, peer: str = "9.9.9.9") -> Request:
    headers = [(b"x-forwarded-for", xff.encode())] if xff is not None else []
    return Request({"type": "http", "headers": headers, "client": (peer, 1234)})


# --------------------------------------------------------------------------- XFF


def test_client_ip_uses_trusted_last_hop(monkeypatch):
    from backend import rate_limit
    from marketer.config import settings

    monkeypatch.setattr(settings, "trusted_proxy_hops", 1)
    # Attacker pre-sets a fake leading entry; the proxy appends the real peer.
    ip = rate_limit.client_ip(_req("203.0.113.7, 198.51.100.9"))
    assert ip == "198.51.100.9"  # the trusted (last) hop, not the forged first


def test_client_ip_spoof_ignored(monkeypatch):
    from backend import rate_limit
    from marketer.config import settings

    monkeypatch.setattr(settings, "trusted_proxy_hops", 1)
    a = rate_limit.client_ip(_req("1.1.1.1, 198.51.100.9"))
    b = rate_limit.client_ip(_req("2.2.2.2, 198.51.100.9"))
    assert a == b == "198.51.100.9"  # forged first hop can't create fresh buckets


def test_client_ip_multi_proxy(monkeypatch):
    from backend import rate_limit
    from marketer.config import settings

    monkeypatch.setattr(settings, "trusted_proxy_hops", 2)
    ip = rate_limit.client_ip(_req("client, realclient, edge"))
    assert ip == "realclient"  # 2 hops back from the end


def test_client_ip_falls_back_to_peer():
    from backend import rate_limit

    assert rate_limit.client_ip(_req(None, peer="9.9.9.9")) == "9.9.9.9"


# --------------------------------------------------------------------------- SSRF


def test_ssrf_blocks_loopback_and_metadata():
    from marketer.services import ssrf

    for bad in (
        "https://127.0.0.1/hook",
        "https://169.254.169.254/latest/meta-data",  # cloud metadata
        "https://10.0.0.5/x",
        "https://192.168.1.1/x",
        "https://0.0.0.0/x",          # unspecified
        "https://224.0.0.1/x",        # multicast
        "https://metadata.google.internal/x",
        "https://metadata.goog/x",
        "http://example.com/x",  # not https
        "https://[::1]/x",       # ipv6 loopback
        "https:///no-host",
    ):
        ok, reason = ssrf.check_public_url(bad)
        assert ok is False, f"{bad} should be blocked"
        assert reason


def test_ssrf_allows_public_ip_literal():
    from marketer.services import ssrf

    ok, _ = ssrf.check_public_url("https://8.8.8.8/hook")
    assert ok is True


def test_ssrf_blocks_hostname_that_resolves_private(monkeypatch):
    """DNS rebinding defense: a public-looking host that resolves to a
    loopback/RFC1918 address must be rejected. Delivery re-runs this
    check so a host that was public at registration cannot later point
    at metadata."""
    import socket

    from marketer.services import ssrf

    def _private(_host, port, *a, **k):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", port or 443))]

    monkeypatch.setattr(ssrf.socket, "getaddrinfo", _private)
    ok, reason = ssrf.check_public_url("https://evil.example/hook")
    assert ok is False
    assert "non-public" in reason


def test_ssrf_blocks_if_any_resolved_address_is_private(monkeypatch):
    import socket

    from marketer.services import ssrf

    def _mixed(_host, port, *a, **k):
        p = port or 443
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", p)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.1.2.3", p)),
        ]

    monkeypatch.setattr(ssrf.socket, "getaddrinfo", _mixed)
    ok, reason = ssrf.check_public_url("https://dual.example/hook")
    assert ok is False
    assert "10.1.2.3" in reason


def test_ssrf_allows_hostname_that_resolves_public(monkeypatch):
    import socket

    from marketer.services import ssrf

    def _public(_host, port, *a, **k):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", port or 443))]

    monkeypatch.setattr(ssrf.socket, "getaddrinfo", _public)
    ok, reason = ssrf.check_public_url("https://hooks.example/x")
    assert ok is True
    assert reason == ""


def test_ssrf_unresolvable_host_is_blocked(monkeypatch):
    import socket

    from marketer.services import ssrf

    def _nx(_host, port, *a, **k):
        raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")

    monkeypatch.setattr(ssrf.socket, "getaddrinfo", _nx)
    ok, reason = ssrf.check_public_url("https://no-such.example/x")
    assert ok is False
    assert "does not resolve" in reason


# --------------------------------------------------------------------------- admin audit


def _admin_client(monkeypatch):
    from tests.test_audit_round2_fixes import _make_admin_client

    return _make_admin_client(monkeypatch)


def test_template_create_is_audited(monkeypatch):
    from uuid import uuid4

    from marketer.models import Template
    from marketer.repos import admin_audit
    from marketer.repos import templates as templates_repo

    audits: list[dict] = []

    async def fake_record(**kw):
        audits.append(kw)

    tid = uuid4()

    async def fake_create(**kw):
        return Template(
            id=tid, created_by="u", kind=kw["kind"], name=kw["name"],
            description=kw.get("description", ""), prompt=kw["prompt"],
            reference_key=kw.get("reference_key", ""),
            is_published=kw.get("is_published", False),
        )

    monkeypatch.setattr(admin_audit, "record", fake_record)
    monkeypatch.setattr(templates_repo, "create", fake_create)

    client = _admin_client(monkeypatch)
    resp = client.post(
        "/api/v1/templates",
        json={"kind": "image", "name": "Look", "prompt": "a prompt",
              "is_published": True},
        headers={"content-length": "80"},
    )
    assert resp.status_code == 201
    assert audits and audits[0]["action"] == "template.create"
    assert audits[0]["target_type"] == "template"


def test_template_delete_is_audited(monkeypatch):
    from uuid import uuid4

    from marketer.repos import admin_audit
    from marketer.repos import templates as templates_repo

    audits: list[dict] = []

    async def fake_record(**kw):
        audits.append(kw)

    async def fake_delete(template_id):
        return True

    monkeypatch.setattr(admin_audit, "record", fake_record)
    monkeypatch.setattr(templates_repo, "delete", fake_delete)

    client = _admin_client(monkeypatch)
    resp = client.delete(f"/api/v1/templates/{uuid4()}")
    assert resp.status_code == 204
    assert audits and audits[0]["action"] == "template.delete"
