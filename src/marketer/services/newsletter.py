"""Newsletter digest composition + sending (Team Newsletters).

compose() mirrors the article pipeline's structured-LLM-call contract
(articles/llm.py): one metered OpenAI call, gated + logged through a
SpendContext. Digests aren't scoped to a single niche, so callers build the
SpendContext with niche_id=None and cap_usd=None -- only the user's global
daily cap applies (spend_ledger.niche_id has been nullable since migration
0018; SpendEntry.niche_id already models this as Optional). See
services/spend_context.py.

The LLM is only trusted to write the subject line, a short intro, and a
one-line editorial hook per article -- never the title, url, or ordering.
Those come straight off the Article / article_publishes rows we already
have, so a hallucinated link or slug is structurally impossible (same
discipline articles/llm.py's interlink_suggest applies to slugs).

send() operates on an already-persisted NewsletterDigest (must carry an id)
and always leaves it in 'sent' or 'failed' -- never mid-flight -- mirroring
services/publishing.py's always-record discipline for article_publishes.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

import openai
from pydantic import BaseModel, ConfigDict, Field

from ..config import settings
from ..logging import get_logger
from .email import send_email
from .openai_pricing import LLM_CALL_ESTIMATE_USD, llm_cost
from .publishing import markdown_to_html
from .spend_context import SpendContext

log = get_logger(__name__)

_client: openai.AsyncOpenAI | None = None


def _oai() -> openai.AsyncOpenAI:
    global _client
    if _client is None:
        _client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


@dataclass
class ComposedDigest:
    """The not-yet-persisted output of compose(). Callers (routes,
    newsletter_cron) hand this to repos.newsletters.create_digest."""

    subject: str
    markdown: str
    html: str
    article_ids: list[UUID] = field(default_factory=list)


class _HookPick(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    hook: str = ""


class _DigestCopy(BaseModel):
    model_config = ConfigDict(extra="ignore")

    subject: str = ""
    intro: str = ""
    hooks: list[_HookPick] = Field(default_factory=list)


async def _published_url(article) -> str:
    """Most recent ok article_publishes.external_url for `article`, read
    read-only -- this module never writes article_publishes."""
    from ..repos import articles as articles_repo

    try:
        publishes = await articles_repo.list_publishes(article.id, user_id=article.user_id)
    except Exception:  # noqa: BLE001 -- a lookup failure must never break compose
        log.warning("newsletter: failed to read publishes for article %s", article.id)
        return ""
    for p in publishes:  # already ordered created_at desc -- first ok wins
        if p.status == "ok" and p.external_url:
            return p.external_url
    return ""


async def _compose_copy(
    user, articles: list, brand, *, spend: SpendContext | None
) -> _DigestCopy:
    brand_name = (getattr(brand, "brand_name", "") or "") if brand is not None else ""
    tone = (getattr(brand, "tone_of_voice", "") or "") if brand is not None else ""
    items = [
        {
            "id": str(a.id),
            "title": a.title or a.topic,
            "excerpt": (a.meta_description or "")[:200],
        }
        for a in articles
    ]
    system = (
        "You are an email newsletter editor. Given a list of articles a "
        "creator just published, write ONE newsletter subject line (50-70 "
        "characters, curiosity-gap style, no clickbait lies), a 1-2 "
        "sentence intro, and a one-line editorial hook per article (a "
        "reason to click -- do NOT just paraphrase the title). Never use "
        "em-dashes or en-dashes. Return a JSON object of shape "
        '{"subject": str, "intro": str, "hooks": [{"id": str, "hook": str}]} '
        "with exactly one hooks entry per article id given, using the id "
        "values verbatim (do not invent ids, do not drop any)."
    )
    user_msg = (
        f"Brand: {brand_name or 'the creator'}\n"
        f"Tone: {tone or 'clear, direct'}\n\n"
        f"Articles (JSON):\n{json.dumps(items, separators=(',', ':'))}\n\n"
        "Return the JSON object."
    )

    if spend is not None:
        await spend.ensure_can_spend(LLM_CALL_ESTIMATE_USD)

    model = settings.agent_model
    resp = await _oai().chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_msg},
        ],
        response_format={"type": "json_object"},
        temperature=0.6,
    )

    if spend is not None:
        u = getattr(resp, "usage", None)
        if u is not None:
            in_tok = int(
                getattr(u, "prompt_tokens", None) or getattr(u, "input_tokens", 0) or 0
            )
            out_tok = int(
                getattr(u, "completion_tokens", None) or getattr(u, "output_tokens", 0) or 0
            )
            await spend.log(
                provider="openai",
                sku=f"llm:{model}",
                units=Decimal(in_tok + out_tok),
                cost_usd=llm_cost(model, in_tok, out_tok),
            )

    raw = resp.choices[0].message.content or "{}"
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = {}
    try:
        return _DigestCopy.model_validate(parsed)
    except Exception:  # noqa: BLE001 -- malformed LLM output degrades, doesn't crash
        return _DigestCopy(subject="", intro="", hooks=[])


async def compose(
    user, articles: list, brand, *, spend: SpendContext | None = None
) -> ComposedDigest:
    """Compose one digest linking `articles` (the period's done articles).
    One metered LLM call for the subject/intro/hooks; titles, urls, and
    ordering are all deterministic from the rows we already have."""
    if not articles:
        markdown = "_No new posts this period._"
        return ComposedDigest(
            subject="Nothing new this period",
            markdown=markdown,
            html=markdown_to_html(markdown),
            article_ids=[],
        )

    copy = await _compose_copy(user, articles, brand, spend=spend)
    hook_by_id = {h.id: h.hook for h in copy.hooks}

    lines: list[str] = []
    if copy.intro:
        lines.append(copy.intro)
        lines.append("")
    for a in articles:
        url = await _published_url(a)
        title = a.title or a.topic
        heading = f"[{title}]({url})" if url else title
        lines.append(f"### {heading}")
        hook = hook_by_id.get(str(a.id), "")
        if hook:
            lines.append(hook)
        lines.append("")
    markdown = "\n".join(lines).strip() + "\n"

    subject = copy.subject.strip() or f"Your {len(articles)}-article digest"
    return ComposedDigest(
        subject=subject,
        markdown=markdown,
        html=markdown_to_html(markdown),
        article_ids=[a.id for a in articles],
    )


async def send(digest, to: str):
    """Send `digest` (a persisted NewsletterDigest -- must carry an id) via
    the existing Resend-based email service, then persist the outcome back
    onto the newsletter_digests row. Always returns the updated row (never
    leaves it 'draft'): a missing recipient or a rejected/failed send is
    recorded as 'failed' with an explanatory error, same as a real
    provider error."""
    from ..repos import newsletters as newsletters_repo

    if not to:
        updated = await newsletters_repo.mark_failed(
            digest.id, error="no recipient email configured"
        )
        return updated or digest

    ok = await send_email(to=to, subject=digest.subject, html=digest.html)
    if not ok:
        updated = await newsletters_repo.mark_failed(
            digest.id, error="email service rejected or failed to send"
        )
        return updated or digest

    updated = await newsletters_repo.mark_sent(digest.id, sent_at=datetime.now(timezone.utc))
    return updated or digest
