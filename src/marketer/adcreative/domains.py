"""Canonicalization policy for user-supplied Brand domains.

A domain arrives from a text box and is then handed to Context.dev,
which fetches it. That makes it an SSRF surface even though we never
open the socket ourselves: a run against `http://169.254.169.254/` or
an internal hostname is a request to have someone else fetch our
infrastructure. So the canonical form is deliberately narrow — a
registrable public hostname, nothing else — and everything downstream
(the Brief, the DB row, the prompts) stores only that form.

`normalize_domain` returns None rather than raising: the caller turns
that into a 422 with a message the user can act on.
"""
from __future__ import annotations

import re
from urllib.parse import urlsplit

from .policy import AD_RUN_LIMITS

_PRIVATE_HOST = re.compile(
    r"^(localhost"
    r"|.*\.localhost"
    r"|.*\.local"
    r"|.*\.internal"
    r"|.*\.home\.arpa"
    r"|metadata\.google\.internal"
    r"|0\.0\.0\.0"
    r"|127(\.\d{1,3}){3}"
    r"|10(\.\d{1,3}){3}"
    r"|192\.168(\.\d{1,3}){2}"
    r"|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}"
    r"|169\.254(\.\d{1,3}){2}"
    r"|\[?::1\]?)$",
    re.IGNORECASE,
)

_DOMAIN = re.compile(
    r"^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$",
    re.IGNORECASE,
)

_IPV4 = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")


def normalize_domain(value: str) -> str | None:
    """`https://www.stripe.com/pricing` -> `stripe.com`.

    None when the input is not a public registrable hostname: bare IPs,
    loopback/RFC1918/link-local literals, and internal TLDs are all
    refused, as is anything that does not parse as a host at all.
    """
    host = (value or "").strip().lower()
    if not host:
        return None
    try:
        parsed = urlsplit(host if "://" in host else f"https://{host}")
        host = parsed.hostname or ""
    except ValueError:
        return None
    if not host:
        return None

    host = host.removeprefix("www.")
    if (
        len(host) > AD_RUN_LIMITS.domain
        or _IPV4.match(host)
        or not _DOMAIN.match(host)
        or _PRIVATE_HOST.match(host)
    ):
        return None
    return host


def homepage_url(domain: str) -> str:
    """The canonical page Context.dev scrapes for the Brief summary."""
    return f"https://{domain}"


def normalize_public_http_url(value: str | None) -> str | None:
    """Bound and sanity-check a logo URL discovered during research.

    The URL is handed to an image provider as a reference, so it gets the
    same public-host treatment as the domain itself. A rejected logo is
    never fatal — the ad renders without one.
    """
    candidate = (value or "").strip()
    if not candidate or len(candidate) > AD_RUN_LIMITS.logo_url:
        return None
    try:
        parsed = urlsplit(candidate)
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return None
    host = parsed.hostname.lower()
    if _IPV4.match(host) or _PRIVATE_HOST.match(host) or not _DOMAIN.match(host):
        return None
    return candidate
