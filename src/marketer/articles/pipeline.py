"""Article pipeline: research → outline → write → QA → metadata → hero image.

`run_article(user_id, niche_id, article_id, topic)` walks an Article from
queued → done with the same discipline as the video pipeline:

- every stage persists the Article row (visible progress, reapable),
- every LLM/image call is metered through SpendContext (niche cap,
  global cap, prepaid credits),
- any unhandled exception terminates as status=failed, never a zombie,
- QA below threshold triggers exactly one corrective rewrite.

Deterministic orchestration (not an orchestrator agent): stage order is
code, LLM judgement lives inside each stage. Cheaper, testable, and
consistent with how the video pipeline is built.
"""
from __future__ import annotations

import asyncio
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator
from uuid import UUID

from opentelemetry import trace

from ..config import settings
from ..logging import get_logger
from ..repos import articles as articles_repo
from ..repos import brand_kit as brand_kit_repo
from ..repos import niches as niches_repo
from ..repos import spend as spend_repo
from ..services import openai_images, otel
from ..services.spend_context import SpendContext, default_context
from . import exa, llm
from .models import Article, ArticleStatus, Outline, SectionContext, SerpAnalysis

log = get_logger(__name__)

QA_THRESHOLD = 0.6
SECTION_CONCURRENCY = 3


def _compose_tone(niche_tone: str, brand: brand_kit_repo.BrandKit | None) -> str:
    """Blend the niche's tone directive with the account brand kit so
    long-form articles come out in the same voice as everything else the
    brand ships. The niche tone leads (it's the most specific); the brand
    voice refines it and banned words become a hard constraint the writer,
    outliner, and QA prompts all see (they all receive this string)."""
    tone = niche_tone or "professional, clear"
    if brand is None:
        return tone
    if brand.tone_of_voice:
        tone = f"{tone}. Brand voice: {brand.tone_of_voice}"
    if brand.banned_words:
        tone = f"{tone}. Never use these words: {', '.join(brand.banned_words)}"
    return tone


@contextmanager
def _stage(name: str) -> Iterator[None]:
    tracer = otel.get_tracer(__name__)
    with tracer.start_as_current_span(f"article.stage.{name}") as span:
        span.set_attribute("marketer.stage", name)
        log.info("article.stage.start", extra={"stage": name})
        started = time.monotonic()
        try:
            yield
        except Exception as exc:
            span.record_exception(exc)
            span.set_status(trace.StatusCode.ERROR, str(exc))
            raise
        finally:
            elapsed_ms = int((time.monotonic() - started) * 1000)
            log.info("article.stage.end", extra={"stage": name, "latency_ms": elapsed_ms})


async def _set_status(article: Article, status: ArticleStatus) -> None:
    article.status = status
    await articles_repo.save(article)


async def _emit_webhook(article: Article, event: str) -> None:
    """Outbound webhook for an article terminal state. Fail-open."""
    try:
        import time as _time

        from ..services import webhook_delivery

        await webhook_delivery.emit(
            article.user_id, event,
            {
                "article_id": str(article.id),
                "niche_id": str(article.niche_id),
                "status": article.status.value,
                "title": article.title,
                "slug": article.slug,
                "error": article.error,
            },
            timestamp=int(_time.time()),
        )
    except Exception as e:  # noqa: BLE001 — never let a webhook break the pipeline
        log.warning("webhook emit failed", extra={"error": str(e)})


async def _notify(article: Article, *, kind: str) -> None:
    """Email the operator when an article reaches a terminal state. Fail-open
    and gated on the user's email-notification preference — matches the video
    pipeline so both content types notify consistently."""
    try:
        from ..repos import users as users_repo
        from ..services import email as email_svc

        user = await users_repo.get(article.user_id)
        if user is None or not user.email or not user.email_notifications:
            return
        title = article.title or article.topic or None
        if kind == "failed":
            subject, html = email_svc.render_article_failed(str(article.id), title)
        else:
            subject, html = email_svc.render_article_done(str(article.id), title)
        await email_svc.send_email(to=user.email, subject=subject, html=html)
    except Exception as e:  # noqa: BLE001 — never let email break the pipeline
        log.warning("article notification failed", extra={"error": str(e)})


async def _fail_with(article: Article, error: str, exc: BaseException | None = None) -> Article:
    article.status = ArticleStatus.failed
    article.error = error
    await articles_repo.save(article)
    await _notify(article, kind="failed")
    await _emit_webhook(article, "article.failed")
    try:
        import sentry_sdk
        if exc is not None:
            sentry_sdk.capture_exception(exc)
        else:
            sentry_sdk.capture_message(
                f"article {article.id} failed: {error}", level="error"
            )
    except Exception:  # sentry not installed/initialised — never block the pipeline
        pass
    return article


async def _write_sections(
    outline: Outline,
    ctx: SectionContext,
    *,
    spend: SpendContext,
) -> str:
    """Write every H2 section (bounded parallel fan-out), preserving order.

    A failed section fails the whole write — publishing an article with a
    placeholder hole is worse than retrying the run.
    """
    h2_sections = [s for s in outline.sections if s.level == 2]
    sem = asyncio.Semaphore(SECTION_CONCURRENCY)

    async def _bounded(heading: str, notes: str) -> str:
        async with sem:
            return await llm.write_section(heading, notes, ctx, spend=spend)

    pieces = await asyncio.gather(
        *[_bounded(s.heading, s.notes) for s in h2_sections]
    )
    body = "\n\n".join(pieces)
    return f"# {outline.title}\n\n{body}"


async def run_article(
    *,
    user_id: str,
    niche_id: UUID,
    article_id: UUID | None = None,
    topic: str = "",
) -> Article:
    niche = await niches_repo.get(niche_id, user_id=user_id)
    if niche is None:
        raise ValueError(f"niche {niche_id} not found for user {user_id}")

    if article_id is not None:
        article = await articles_repo.get(article_id, user_id=user_id)
        if article is None:
            raise ValueError(f"article {article_id} not found for user {user_id}")
        if topic:
            article.topic = topic
    else:
        article = await articles_repo.create(
            user_id=user_id, niche_id=niche_id, topic=topic
        )

    spend = await default_context(
        user_id=user_id,
        niche_id=niche_id,
        job_id=None,
        article_id=article.id,
        cap_usd=niche.daily_spend_cap_usd,
    )

    tracer = otel.get_tracer(__name__)
    with tracer.start_as_current_span("article.run") as span:
        span.set_attribute("marketer.user_id", user_id)
        span.set_attribute("marketer.niche_id", str(niche_id))
        span.set_attribute("marketer.article_id", str(article.id))
        try:
            result = await _run_inner(article, niche, spend)
        except spend_repo.SpendCapExceeded as exc:
            span.record_exception(exc)
            return await _fail_with(article, str(exc), exc)
        except Exception as exc:
            # Terminal backstop — mirror of the video pipeline's: a failed
            # provider call must produce a failed (retryable) row, not a
            # zombie stuck mid-status.
            span.record_exception(exc)
            span.set_status(trace.StatusCode.ERROR, str(exc))
            return await _fail_with(article, f"{type(exc).__name__}: {exc}", exc)
        span.set_attribute("marketer.article_status", result.status.value)
        return result


async def _run_inner(article: Article, niche, spend: SpendContext) -> Article:
    brand = await brand_kit_repo.get(article.user_id)
    tone = _compose_tone(getattr(niche, "tts_style_directions", "") or "", brand)
    audience = niche.target_audience

    # 0. Topic — pick one when the caller didn't supply it.
    if not article.topic:
        recent = await articles_repo.recent_titles_for_niche(
            article.niche_id, user_id=article.user_id
        )
        pick = await llm.pick_topic(
            niche.title, niche.description, recent, spend=spend
        )
        article.topic = pick.topic
        article.focus_keyword = pick.focusKeyword
    if not article.focus_keyword:
        article.focus_keyword = article.topic

    # 1. Research
    with _stage(ArticleStatus.researching.value):
        await _set_status(article, ArticleStatus.researching)
        pages = await exa.serp_pages(article.focus_keyword)
        if pages:
            serp = await llm.summarize_serp(article.focus_keyword, pages, spend=spend)
        else:
            # Degraded mode: no SERP provider configured/reachable. The
            # outline prompt still works from model knowledge.
            serp = SerpAnalysis()

    # 2. Outline
    with _stage(ArticleStatus.outlining.value):
        await _set_status(article, ArticleStatus.outlining)
        outline = await llm.generate_outline(
            article.topic,
            article.focus_keyword,
            serp.model_dump(),
            tone,
            audience,
            spend=spend,
        )

    # 3. Write (parallel per-H2 fan-out)
    with _stage(ArticleStatus.writing.value):
        await _set_status(article, ArticleStatus.writing)
        ctx = SectionContext(
            title=outline.title,
            topic=article.topic,
            focusKeyword=article.focus_keyword,
            tone=tone,
            targetAudience=audience,
            outline=outline,
            research=serp if serp.topResults else None,
        )
        markdown = await _write_sections(outline, ctx, spend=spend)

    # 4. QA — one corrective rewrite when below threshold.
    with _stage(ArticleStatus.qa.value):
        await _set_status(article, ArticleStatus.qa)
        quality = await llm.score_article(
            markdown, article.focus_keyword, spend=spend
        )
        if quality.overall < QA_THRESHOLD:
            log.info(
                "article qa below threshold; one corrective rewrite",
                extra={"overall": quality.overall},
            )
            ctx = ctx.model_copy(update={"revisionNotes": quality.notes})
            markdown = await _write_sections(outline, ctx, spend=spend)
            quality = await llm.score_article(
                markdown, article.focus_keyword, spend=spend
            )
        article.quality = quality
        article.word_count = len(markdown.split())

    # 5. Metadata + JSON-LD schema + internal-link suggestions
    with _stage(ArticleStatus.metadata.value):
        await _set_status(article, ArticleStatus.metadata)
        meta = await llm.generate_metadata(
            article.topic, article.focus_keyword, markdown, tone, spend=spend
        )
        article.title = meta.title
        article.slug = meta.slug
        article.meta_description = meta.metaDescription
        article.keywords = meta.keywords
        article.schema_jsonld = await llm.generate_schema_json(
            title=meta.title,
            slug=meta.slug,
            meta_description=meta.metaDescription,
            focus_keyword=meta.focusKeyword,
            keywords=meta.keywords,
            article_md=markdown,
            spend=spend,
        )
        candidates = await articles_repo.interlink_candidates(article.user_id)
        candidates = [c for c in candidates if c["slug"] != meta.slug]
        article.link_suggestions = await llm.interlink_suggest(
            markdown, candidates, spend=spend
        )
        article.article_markdown = markdown

    # 6. Hero image (optional) — reuses the video pipeline's gpt-image-1
    # provider, so pricing/caps/ledger are identical.
    if settings.article_hero_image:
        with _stage(ArticleStatus.imaging.value):
            await _set_status(article, ArticleStatus.imaging)
            prompt = await llm.generate_hero_prompt(
                article.title or article.topic,
                article.focus_keyword,
                markdown,
                spend=spend,
            )
            if prompt is not None:
                hero = (
                    Path(settings.artifacts_dir)
                    / article.user_id
                    / "articles"
                    / str(article.id)
                    / "hero.png"
                )
                await openai_images.generate_keyframe(
                    prompt.prompt, hero, quality=niche.image_quality, spend=spend
                )
                article.hero_image_path = str(hero)
                article.hero_image_alt = prompt.altText

    article.status = ArticleStatus.done
    article.error = None
    await articles_repo.save(article)
    log.info("article done", extra={"article_id": str(article.id)})
    await _notify(article, kind="done")
    await _emit_webhook(article, "article.done")
    return article
