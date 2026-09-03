"""CORS origin resolution.

Production used to fall open to ``*`` whenever ``MARKETER_WEB_ORIGIN``
was unset — which is the default on Modal because that key lives in the
unmounted ``marketer-extra`` secret. If ``MARKETER_APP_URL`` is set
(checkout redirects, email links) we reuse it as the allow-list so the
browser app can talk to the API without a second env var.
"""

from __future__ import annotations


def parse_origins(raw: str) -> list[str]:
    return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]


def resolve_cors_origins(web_origin: str, app_url: str) -> tuple[list[str], bool]:
    """Return ``(allow_origins, allow_credentials)``.

    Credentials are only enabled when the allow-list is explicit. A
    wildcard list never ships with credentials, matching the previous
    local-dev fallback.
    """
    origins = parse_origins(web_origin)
    if origins:
        return origins, True
    fallback = app_url.strip().rstrip("/")
    if fallback:
        return [fallback], True
    return ["*"], False
