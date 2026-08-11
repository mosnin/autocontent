"""SSRF guard for user-supplied outbound URLs (webhook endpoints).

A registered webhook URL is fetched server-side on every event, so an
unchecked URL lets a user point us at internal infrastructure —
`https://169.254.169.254/…` (cloud metadata), loopback, or private RFC1918
hosts. We resolve the hostname and reject any URL that resolves to a
non-public address, both at registration AND again at delivery time (the
second check defends against DNS rebinding: a host that resolved public at
registration can later point at an internal IP).
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

# Hostnames that resolve publicly-ish but are cloud metadata endpoints.
_BLOCKED_HOSTS = {"metadata.google.internal", "metadata.goog"}


def _ip_blocked(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True  # unparseable -> refuse
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local  # 169.254.0.0/16 — cloud metadata
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def check_public_url(url: str) -> tuple[bool, str]:
    """(ok, reason). Blocking (does DNS) — call via asyncio.to_thread in async
    code. ok=True only when the URL is https and every resolved address is a
    routable public IP."""
    parsed = urlparse(url)
    if parsed.scheme != "https":
        return False, "url must be https"
    host = parsed.hostname
    if not host:
        return False, "url has no host"
    if host.lower() in _BLOCKED_HOSTS:
        return False, "host is not permitted"
    # A literal IP host is checked directly (no DNS).
    try:
        ipaddress.ip_address(host)
        literal = True
    except ValueError:
        literal = False
    if literal:
        return (False, f"host {host} is not a public address") if _ip_blocked(host) else (True, "")
    try:
        infos = socket.getaddrinfo(host, parsed.port or 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        return False, "host does not resolve"
    if not infos:
        return False, "host does not resolve"
    for info in infos:
        ip = info[4][0]
        if _ip_blocked(ip):
            return False, f"host resolves to a non-public address ({ip})"
    return True, ""
