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
from . import exa, fastpath, llm
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


async def _signal_terminal(article: Article, *, kind: str, event: str) -> None:
    """Email + outbound webhook in one beat. Both are fail-open."""
    await asyncio.gather(
        _notify(article, kind=kind),
        _emit_webhook(article, event),
    )


async def _fail_with(article: Article, error: str, exc: BaseException | None = None) -> Article:
    article.status = ArticleStatus.failed
    article.error = error
    await articles_repo.save(article)
    await _signal_terminal(article, kind="failed", event="article.failed")
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


async def _render_hero(
    prompt: str,
    path: Path,
    *,
    alt: str,
    quality: str,
    spend: SpendContext,
) -> tuple[Path, str]:
    await openai_images.generate_keyframe(
        prompt, path, quality=quality, spend=spend
    )
    return path, alt


def _start_hero_task(
    article: Article,
    *,
    quality: str,
    spend: SpendContext,
) -> asyncio.Task | None:
    """Kick gpt-image-1 once topic + keyword exist. Template prompt — no writer."""
    try:
        prompt = fastpath.hero_prompt(article.topic, article.focus_keyword)
    except Exception as exc:  # noqa: BLE001 — prompt is non-essential
        log.warning(
            "article hero prompt degraded",
            extra={"article_id": str(article.id), "error": str(exc)},
        )
        return None
    hero = (
        Path(settings.artifacts_dir)
        / article.user_id
        / "articles"
        / str(article.id)
        / "hero.png"
    )
    return asyncio.create_task(
        _render_hero(
            prompt.prompt,
            hero,
            alt=prompt.altText,
            quality=quality,
            spend=spend,
        )
    )


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
            templated = (
                fastpath.faq_section_from_research(heading, ctx.research)
                or fastpath.checklist_section_from_research(heading, ctx.research)
                or fastpath.definition_section_from_research(heading, ctx.research)
                or fastpath.how_to_section_from_research(heading, ctx.research)
                or fastpath.mistakes_section_from_research(heading, ctx.research)
            )
            if templated:
                return templated
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
    async def _knowledge_block() -> str:
        try:
            from ..company_os.knowledge import prompt_block

            return await prompt_block(article.user_id)
        except Exception:  # noqa: BLE001 — knowledge seasons, never blocks
            return ""

    async def _writing_kit():
        try:
            from ..repos import kits as kits_repo

            return await kits_repo.resolve(
                user_id=article.user_id,
                kind="writing",
                kit_id=getattr(niche, "writing_kit_id", None),
            )
        except Exception:  # noqa: BLE001 — kits season, they never block
            return None

    async def _recent_titles() -> list[str]:
        if article.topic:
            return []
        return await articles_repo.recent_titles_for_niche(
            article.niche_id, user_id=article.user_id
        )

    brand, block, writing_kit, recent = await asyncio.gather(
        brand_kit_repo.get(article.user_id),
        _knowledge_block(),
        _writing_kit(),
        _recent_titles(),
    )
    tone = _compose_tone(getattr(niche, "tts_style_directions", "") or "", brand)
    if block:
        tone = f"{tone}\n{block}"
    if writing_kit is not None and writing_kit.content:
        tone = (
            f"{tone}\nWriting kit — the author's voice & style system, "
            f"follow it throughout:\n{writing_kit.content}"
        )
    audience = niche.target_audience

    # 0. Topic — templates + Jev, not a chat completion.
    if not article.topic:
        pick = await fastpath.pick_topic(
            niche.title,
            niche.description,
            recent,
            audience=audience,
            spend=spend,
        )
        article.topic = pick.topic
        article.focus_keyword = pick.focusKeyword
    if not article.focus_keyword:
        article.focus_keyword = article.topic

    # Hero only needs topic + keyword. Start it before research so
    # gpt-image-1 hides behind Exa + write + QA. Imaging still awaits;
    # spend-cap still fails the article; other failures still degrade.
    hero_task: asyncio.Task | None = None
    try:
        if settings.article_hero_image:
            hero_task = _start_hero_task(
                article, quality=niche.image_quality, spend=spend
            )

        return await _run_after_topic(
            article, niche, spend, audience, tone, hero_task
        )
    finally:
        if hero_task is not None and not hero_task.done():
            hero_task.cancel()
            try:
                await hero_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass


async def _run_after_topic(
    article: Article,
    niche,
    spend: SpendContext,
    audience: str,
    tone: str,
    hero_task: asyncio.Task | None,
) -> Article:
    # 1. Research — Exa + Jev rank, then deterministic SERP extract.
    with _stage(ArticleStatus.researching.value):
        await _set_status(article, ArticleStatus.researching)

        async def _warm_jev() -> None:
            try:
                from ..jev.client import warm

                await warm()
            except Exception:  # noqa: BLE001 — prefetch never blocks research
                return

        pages, _ = await asyncio.gather(
            exa.serp_pages(article.focus_keyword),
            _warm_jev(),
        )
        from ..jev.loops import filter_research_pages

        pages = await filter_research_pages(
            article.focus_keyword, pages, spend=spend
        )
        if pages:
            serp = fastpath.serp_from_pages(article.focus_keyword, pages)
        else:
            # Degraded mode: no SERP provider configured/reachable.
            # Outline falls back to the default playbook headings.
            serp = SerpAnalysis()

    # 2. Outline — SERP headings + playbook. No chat completion.
    with _stage(ArticleStatus.outlining.value):
        await _set_status(article, ArticleStatus.outlining)
        outline = fastpath.outline_from_research(
            article.topic, article.focus_keyword, serp
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
        from ..jev.grounding import allowed_facts, strip_ungrounded_claims

        markdown, lock_notes = strip_ungrounded_claims(markdown, allowed_facts(serp))

    # 4. QA — fact-lock first, then score + citation-verifier in parallel.
    with _stage(ArticleStatus.qa.value):
        await _set_status(article, ArticleStatus.qa)
        from ..jev.loops import source_audit_penalty

        quality, (audit_notes, penalty) = await asyncio.gather(
            llm.score_article(markdown, article.focus_keyword, spend=spend),
            source_audit_penalty(markdown, pages if pages else [], spend=spend),
        )
        quality.notes.extend(lock_notes)
        quality.notes.extend(audit_notes)
        quality.overall = max(0.0, float(quality.overall) - penalty)
        if quality.overall < QA_THRESHOLD:
            log.info(
                "article qa below threshold; one corrective rewrite",
                extra={"overall": quality.overall},
            )
            ctx = ctx.model_copy(update={"revisionNotes": quality.notes})
            markdown = await _write_sections(outline, ctx, spend=spend)
            markdown, lock_notes = strip_ungrounded_claims(
                markdown, allowed_facts(serp)
            )
            quality, (audit_notes, penalty) = await asyncio.gather(
                llm.score_article(markdown, article.focus_keyword, spend=spend),
                source_audit_penalty(
                    markdown, pages if pages else [], spend=spend
                ),
            )
            quality.notes.extend(lock_notes)
            quality.notes.extend(audit_notes)
            quality.overall = max(0.0, float(quality.overall) - penalty)
        article.quality = quality
        article.word_count = len(markdown.split())

    # 5. Metadata + JSON-LD schema + internal-link suggestions.
    # Hero already started after topic pick — this stage is SEO only.
    with _stage(ArticleStatus.metadata.value):
        await _set_status(article, ArticleStatus.metadata)
        meta = fastpath.metadata_from_article(
            article.topic, article.focus_keyword, markdown
        )
        article.title = meta.title
        article.slug = meta.slug
        article.meta_description = meta.metaDescription
        from ..jev.loops import seo_metadata_notes

        seo_notes, candidates = await asyncio.gather(
            seo_metadata_notes(
                title=meta.title,
                meta_description=meta.metaDescription,
                focus_keyword=article.focus_keyword,
                article_excerpt=markdown,
                spend=spend,
            ),
            articles_repo.interlink_candidates(article.user_id),
        )
        if seo_notes and article.quality is not None:
            article.quality.notes.extend(seo_notes)
        article.keywords = meta.keywords
        article.schema_jsonld = fastpath.schema_json(
            title=meta.title,
            slug=meta.slug,
            meta_description=meta.metaDescription,
            focus_keyword=meta.focusKeyword,
            keywords=meta.keywords,
            article_md=markdown,
        )
        candidates = [c for c in candidates if c["slug"] != meta.slug]
        article.link_suggestions = fastpath.interlink_lexical(markdown, candidates)
        article.article_markdown = markdown

    # 6. Hero image (optional, non-essential) — render started after
    # topic pick so gpt-image-1 overlaps research + write + QA. A
    # failure here must DEGRADE rather than fail the article. A
    # spend-cap breach is the one exception: that's a real-money
    # guardrail. Imaging stage still exists so stage-order tests pass.
    if settings.article_hero_image:
        with _stage(ArticleStatus.imaging.value):
            await _set_status(article, ArticleStatus.imaging)
            if hero_task is not None:
                try:
                    path, alt = await hero_task
                    article.hero_image_path = str(path)
                    article.hero_image_alt = alt
                except spend_repo.SpendCapExceeded:
                    raise
                except Exception as exc:  # noqa: BLE001 — hero is non-essential
                    log.warning(
                        "article hero image degraded; publishing without one",
                        extra={"article_id": str(article.id), "error": str(exc)},
                    )

    article.status = ArticleStatus.done
    article.error = None
    await articles_repo.save(article)
    log.info("article done", extra={"article_id": str(article.id)})
    await _signal_terminal(article, kind="done", event="article.done")
    return article
