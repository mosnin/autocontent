"""SSRF guard for user-supplied outbound URLs (webhook endpoints).

A registered webhook URL is fetched server-side on every event, so an
unchecked URL lets a user point us at internal infrastructure —
`https://169.254.169.254/…` (cloud metadata), loopback, or private RFC1918
hosts. We resolve the hostname and reject any URL that resolves to a
non-public address, both at registration AND again at delivery time. At
delivery the request is sent to the address that was just checked
(``resolve_public_url`` + ``pinned_target``), not to the hostname: checking a
name and then letting the HTTP client resolve it again leaves a window in
which the answer changes (DNS rebinding).
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

# Hostnames that resolve publicly-ish but are cloud metadata endpoints.
_BLOCKED_HOSTS = {"metadata.google.internal", "metadata.goog"}


# Ranges `ipaddress` does not flag on every Python version, listed explicitly so
# the guard does not depend on the interpreter.
_EXTRA_BLOCKED = tuple(
    ipaddress.ip_network(n)
    for n in (
        "100.64.0.0/10",     # carrier-grade NAT (cloud-internal on several providers)
        "192.0.0.0/24",      # IETF protocol assignments
        "198.18.0.0/15",     # benchmarking
        "64:ff9b::/96",      # NAT64: embeds an IPv4 address
        "2002::/16",         # 6to4: embeds an IPv4 address
        "fd00:ec2::/32",     # AWS IMDS over IPv6
    )
)


def _ip_blocked(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str.split("%", 1)[0])  # drop an IPv6 zone id
    except ValueError:
        return True  # unparseable -> refuse
    # ::ffff:127.0.0.1 and friends are the IPv4 address in disguise.
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        ip = mapped
    if any(ip in net for net in _EXTRA_BLOCKED if net.version == ip.version):
        return True
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local  # 169.254.0.0/16 — cloud metadata
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
        or not ip.is_global
    )


def resolve_public_url(url: str) -> tuple[bool, str, str | None]:
    """(ok, reason, address). Blocking (does DNS): call via asyncio.to_thread.

    ok=True only when the URL is https, carries no credentials, and every
    resolved address is a routable public IP. ``address`` is the one the
    caller must connect to. Connecting to the hostname instead would resolve
    it a second time, and a hostile DNS server answers the check with a
    public address and the connection with an internal one (DNS rebinding)."""
    parsed = urlparse(url)
    if parsed.scheme != "https":
        return False, "url must be https", None
    try:
        host = parsed.hostname
        port = parsed.port or 443
    except ValueError:
        return False, "url has an invalid host or port", None
    if not host:
        return False, "url has no host", None
    if parsed.username is not None or parsed.password is not None:
        return False, "url must not carry credentials", None
    if host.lower().rstrip(".") in _BLOCKED_HOSTS:
        return False, "host is not permitted", None

    # A literal IP host is checked directly (no DNS).
    try:
        ipaddress.ip_address(host)
        literal = True
    except ValueError:
        literal = False
    if literal:
        if _ip_blocked(host):
            return False, f"host {host} is not a public address", None
        return True, "", host

    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except (socket.gaierror, UnicodeError):
        return False, "host does not resolve", None
    if not infos:
        return False, "host does not resolve", None
    addresses = [info[4][0] for info in infos]
    for ip in addresses:
        if _ip_blocked(ip):
            return False, f"host resolves to a non-public address ({ip})", None
    return True, "", addresses[0]


def check_public_url(url: str) -> tuple[bool, str]:
    """(ok, reason). Blocking (does DNS) — call via asyncio.to_thread in async
    code. Use ``resolve_public_url`` when you are about to connect."""
    ok, reason, _ = resolve_public_url(url)
    return ok, reason


def pinned_target(url: str, address: str) -> tuple[str, str, str]:
    """(url_with_address_as_host, host_header, tls_server_name) for connecting
    to ``address`` while still speaking to the original host: the request goes
    to the vetted IP, and TLS (SNI and certificate check) and the Host header
    keep the hostname."""
    parsed = urlparse(url)
    host = parsed.hostname or ""
    literal = f"[{address}]" if ":" in address else address
    netloc = literal if parsed.port in (None, 443) else f"{literal}:{parsed.port}"
    host_header = host if parsed.port in (None, 443) else f"{host}:{parsed.port}"
    return parsed._replace(netloc=netloc).geturl(), host_header, host
