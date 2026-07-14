"""Transactional email via Resend's HTTP API.

Deliberately dependency-free (httpx only) and fail-open: an unset key or
a provider error must never break the pipeline — a missed email is an
annoyance, a failed job is a refund.
"""
from __future__ import annotations

import httpx

from ..config import settings
from ..logging import get_logger

log = get_logger(__name__)

_RESEND_URL = "https://api.resend.com/emails"


async def send_email(*, to: str, subject: str, html: str) -> bool:
    """Send one email. Returns True on acceptance, False on any skip or
    failure (missing key, empty recipient, provider error)."""
    if not settings.resend_api_key or not to:
        return False
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                _RESEND_URL,
                headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                json={
                    "from": settings.email_from,
                    "to": [to],
                    "subject": subject,
                    "html": html,
                },
            )
        if resp.status_code >= 400:
            log.warning(
                "email send failed",
                extra={"status": resp.status_code, "body": resp.text[:200]},
            )
            return False
        return True
    except Exception as e:  # noqa: BLE001 — fail open by design
        log.warning("email send errored", extra={"error": str(e)})
        return False


def _button(href: str, label: str) -> str:
    return (
        f'<a href="{href}" style="display:inline-block;padding:10px 20px;'
        f"background:#f4470f;color:#ffffff;text-decoration:none;"
        f'border-radius:8px;font-weight:600">{label}</a>'
    )


def _shell(body: str) -> str:
    return (
        '<div style="font-family:system-ui,-apple-system,sans-serif;'
        'max-width:480px;margin:0 auto;padding:32px 24px;color:#18181b">'
        f"{body}"
        '<p style="margin-top:32px;font-size:12px;color:#71717a">'
        "marketer — the content machine that ships itself</p></div>"
    )


def render_ready_for_review(job_id: str, hook: str | None) -> tuple[str, str]:
    """Subject + HTML for an awaiting_approval notification."""
    base = settings.app_url.rstrip("/") or "http://localhost:3000"
    hook_line = f"<p style='font-style:italic'>&ldquo;{hook}&rdquo;</p>" if hook else ""
    subject = "Your video is ready to review"
    html = _shell(
        "<h2 style='margin:0 0 12px'>A new video is waiting for your sign-off</h2>"
        f"{hook_line}"
        "<p>It rendered, passed QA, and is parked in the queue. It will not "
        "post until you approve it.</p>"
        f"<p style='margin-top:24px'>{_button(f'{base}/queue/{job_id}', 'Review the video')}</p>"
    )
    return subject, html


def render_video_scheduled(job_id: str, hook: str | None) -> tuple[str, str]:
    """Subject + HTML for a done/scheduled notification."""
    base = settings.app_url.rstrip("/") or "http://localhost:3000"
    hook_line = f"<p style='font-style:italic'>&ldquo;{hook}&rdquo;</p>" if hook else ""
    subject = "Your machine shipped a video"
    html = _shell(
        "<h2 style='margin:0 0 12px'>A new video just went out</h2>"
        f"{hook_line}"
        "<p>Rendered, mixed, captioned, and scheduled — start to finish, "
        "no hands on the wheel.</p>"
        f"<p style='margin-top:24px'>{_button(f'{base}/queue/{job_id}', 'Watch it')}</p>"
    )
    return subject, html
