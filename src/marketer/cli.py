"""``marketer`` CLI.

Reads ``MARKETER_API_BASE_URL`` and ``MARKETER_API_TOKEN`` from the
environment, then dispatches to the async :class:`MarketerClient`.

stdlib only — no typer/click/rich. Tables are formatted by hand so the
output is easy to pipe.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from decimal import Decimal
from typing import Any, Awaitable, Callable, Sequence

from pydantic import BaseModel

from .models import (
    Job,
    Niche,
    NicheCreatePayload,
    PersonalAccessToken,
    PostingWindow,
    TodaySpend,
)
from .sdk import ENV_BASE_URL, ENV_TOKEN, MarketerClient, MarketerError

PLATFORMS = ["tiktok", "reels", "shorts"]


# ---------------------------------------------------------------- formatting


def _to_jsonable(obj: Any) -> Any:
    if isinstance(obj, BaseModel):
        return json.loads(obj.model_dump_json())
    if isinstance(obj, list):
        return [_to_jsonable(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, Decimal):
        return str(obj)
    return obj


def _dump_json(obj: Any) -> str:
    return json.dumps(_to_jsonable(obj), indent=2, default=str)


def _format_table(rows: list[dict[str, Any]], columns: list[str]) -> str:
    if not rows:
        return "(no rows)"
    widths = {c: len(c) for c in columns}
    str_rows: list[dict[str, str]] = []
    for r in rows:
        s = {c: ("" if r.get(c) is None else str(r.get(c))) for c in columns}
        for c in columns:
            widths[c] = max(widths[c], len(s[c]))
        str_rows.append(s)
    header = "  ".join(c.ljust(widths[c]) for c in columns)
    sep = "  ".join("-" * widths[c] for c in columns)
    body = "\n".join("  ".join(r[c].ljust(widths[c]) for c in columns) for r in str_rows)
    return f"{header}\n{sep}\n{body}"


def _niche_row(n: Niche) -> dict[str, Any]:
    return {
        "id": str(n.id),
        "title": n.title,
        "platforms": ",".join(n.platforms),
        "cap_usd": str(n.daily_spend_cap_usd),
        "archived": "yes" if n.archived_at else "no",
        "created_at": n.created_at.isoformat(),
    }


def _job_row(j: Job) -> dict[str, Any]:
    return {
        "id": str(j.id),
        "niche_id": str(j.niche_id),
        "platform": j.platform,
        "status": j.status.value,
        "created_at": j.created_at.isoformat(),
        "scheduled_for": j.scheduled_for.isoformat() if j.scheduled_for else "",
        "error": (j.error or "")[:60],
    }


def _token_row(t: PersonalAccessToken) -> dict[str, Any]:
    return {
        "id": str(t.id),
        "name": t.name,
        "prefix": t.prefix,
        "created_at": t.created_at.isoformat(),
        "expires_at": t.expires_at.isoformat() if t.expires_at else "",
        "last_used_at": t.last_used_at.isoformat() if t.last_used_at else "",
    }


# ---------------------------------------------------------------- output helpers


def _print_rows(
    rows: list[Any],
    columns: list[str],
    row_fn: Callable[[Any], dict[str, Any]],
    *,
    as_json: bool,
    out=None,
) -> None:
    out = out or sys.stdout
    if as_json:
        print(_dump_json(rows), file=out)
    else:
        print(_format_table([row_fn(r) for r in rows], columns), file=out)


def _print_one(obj: Any, *, out=None) -> None:
    out = out or sys.stdout
    print(_dump_json(obj), file=out)


def _confirm(msg: str) -> None:
    print(msg, file=sys.stderr)


# ---------------------------------------------------------------- env check


def _check_env() -> tuple[str, str] | None:
    base_url = os.environ.get(ENV_BASE_URL, "").strip()
    token = os.environ.get(ENV_TOKEN, "").strip()
    if not base_url or not token:
        return None
    return base_url, token


# ---------------------------------------------------------------- handlers


async def _run(handler: Callable[[MarketerClient, argparse.Namespace], Awaitable[None]],
               args: argparse.Namespace) -> None:
    async with MarketerClient() as client:
        await handler(client, args)


# --- niches

async def h_niches_list(c: MarketerClient, a: argparse.Namespace) -> None:
    items = await c.list_niches()
    _print_rows(items, ["id", "title", "platforms", "cap_usd", "archived", "created_at"],
                _niche_row, as_json=a.json)


async def h_niches_get(c: MarketerClient, a: argparse.Namespace) -> None:
    _print_one(await c.get_niche(a.id))


async def h_niches_create(c: MarketerClient, a: argparse.Namespace) -> None:
    platforms = [p.strip() for p in a.platforms.split(",") if p.strip()]
    for p in platforms:
        if p not in PLATFORMS:
            raise SystemExit(f"unknown platform '{p}' (allowed: {','.join(PLATFORMS)})")
    payload = NicheCreatePayload(
        title=a.title,
        description=a.description,
        target_audience=a.target_audience,
        hashtags=[h.strip() for h in (a.hashtags or "").split(",") if h.strip()],
        visual_style=a.visual_style,
        voice=a.voice,
        target_duration_sec=a.target_duration_sec,
        scene_count=a.scene_count,
        posting_windows=[PostingWindow(hour=a.posting_hour, minute=a.posting_minute, tz=a.tz)],
        platforms=platforms,  # type: ignore[arg-type]
        daily_spend_cap_usd=Decimal(str(a.daily_spend_cap_usd)),
        image_quality=a.image_quality,
        video_resolution=a.video_resolution,
        scene_max_duration_sec=a.scene_max_duration_sec,
        tts_style_directions=a.tts_style_directions,
    )
    n = await c.create_niche(payload)
    _confirm(f"created niche {n.id}")
    _print_one(n)


async def h_niches_archive(c: MarketerClient, a: argparse.Namespace) -> None:
    await c.archive_niche(a.id)
    _confirm(f"archived niche {a.id}")


# --- jobs

async def h_jobs_list(c: MarketerClient, a: argparse.Namespace) -> None:
    items = await c.list_jobs(status=a.status, limit=a.limit)
    _print_rows(items,
                ["id", "niche_id", "platform", "status", "created_at", "scheduled_for", "error"],
                _job_row, as_json=a.json)


async def h_jobs_get(c: MarketerClient, a: argparse.Namespace) -> None:
    _print_one(await c.get_job(a.id))


async def h_jobs_enqueue(c: MarketerClient, a: argparse.Namespace) -> None:
    if a.platform not in PLATFORMS:
        raise SystemExit(f"unknown platform '{a.platform}'")
    job = await c.enqueue_job(niche_id=a.niche, platform=a.platform)
    _confirm(f"enqueued job {job.id} for niche {a.niche} on {a.platform}")
    _print_one(job)


async def h_jobs_retry(c: MarketerClient, a: argparse.Namespace) -> None:
    job = await c.retry_job(a.id)
    _confirm(f"retrying job {job.id}")
    _print_one(job)


def _article_row(a) -> list[str]:
    return [
        str(a.id), str(a.niche_id), a.status.value,
        (a.title or a.topic or "")[:48],
        str(a.word_count or ""),
        str(a.created_at or ""),
        a.error or "",
    ]


async def h_articles_list(c: MarketerClient, a: argparse.Namespace) -> None:
    items = await c.list_articles(status=a.status, niche_id=a.niche, limit=a.limit)
    _print_rows(items,
                ["id", "niche_id", "status", "title", "words", "created_at", "error"],
                _article_row, as_json=a.json)


async def h_articles_get(c: MarketerClient, a: argparse.Namespace) -> None:
    _print_one(await c.get_article(a.id))


async def h_articles_markdown(c: MarketerClient, a: argparse.Namespace) -> None:
    print(await c.get_article_markdown(a.id))


async def h_articles_generate(c: MarketerClient, a: argparse.Namespace) -> None:
    article = await c.generate_article(niche_id=a.niche, topic=a.topic or "")
    _confirm(f"generating article {article.id} for niche {a.niche}")
    _print_one(article)


async def h_articles_retry(c: MarketerClient, a: argparse.Namespace) -> None:
    article = await c.retry_article(a.id)
    _confirm(f"retrying article {article.id}")
    _print_one(article)


# --- spend

async def h_spend_today(c: MarketerClient, a: argparse.Namespace) -> None:
    spend: TodaySpend = await c.today_spend()
    if a.json:
        _print_one(spend)
        return
    print(f"total_usd: {spend.total_usd}")
    if spend.by_niche:
        rows = [{"niche_id": k, "usd": str(v)} for k, v in spend.by_niche.items()]
        print(_format_table(rows, ["niche_id", "usd"]))


# --- connect

async def h_connect_ayrshare(c: MarketerClient, a: argparse.Namespace) -> None:
    res = await c.connect_ayrshare()
    _confirm("Open this URL to connect TikTok / Instagram / YouTube:")
    print(res.login_url)


# --- tokens

async def h_tokens_list(c: MarketerClient, a: argparse.Namespace) -> None:
    items = await c.list_tokens()
    _print_rows(items, ["id", "name", "prefix", "created_at", "expires_at", "last_used_at"],
                _token_row, as_json=a.json)


async def h_tokens_create(c: MarketerClient, a: argparse.Namespace) -> None:
    info, plaintext = await c.create_token(name=a.name, expires_in_days=a.expires_in_days)
    _confirm(f"created token {info.id} ({info.prefix}). Plaintext below — store it now.")
    print(plaintext)


async def h_tokens_revoke(c: MarketerClient, a: argparse.Namespace) -> None:
    await c.revoke_token(a.id)
    _confirm(f"revoked token {a.id}")


# ---------------------------------------------------------------- parser


def _add_json_flag(p: argparse.ArgumentParser) -> None:
    p.add_argument("--json", action="store_true", help="emit raw JSON")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="marketer", description="marketer CLI")
    sub = parser.add_subparsers(dest="group", required=True)

    # niches
    niches = sub.add_parser("niches", help="manage niches").add_subparsers(
        dest="cmd", required=True
    )
    p = niches.add_parser("list")
    _add_json_flag(p)
    p.set_defaults(handler=h_niches_list)

    p = niches.add_parser("get")
    p.add_argument("id")
    p.set_defaults(handler=h_niches_get)

    p = niches.add_parser("create")
    p.add_argument("--title", required=True)
    p.add_argument("--description", required=True)
    p.add_argument("--target-audience", required=True)
    p.add_argument("--visual-style", required=True)
    p.add_argument("--voice", required=True)
    p.add_argument("--target-duration-sec", type=int, required=True)
    p.add_argument("--scene-count", type=int, required=True)
    p.add_argument("--platforms", required=True,
                   help="comma-separated subset of tiktok,reels,shorts")
    p.add_argument("--daily-spend-cap-usd", required=True)
    p.add_argument("--posting-hour", type=int, required=True)
    p.add_argument("--posting-minute", type=int, required=True)
    p.add_argument("--tz", required=True, help="IANA TZ name, e.g. America/Los_Angeles")
    p.add_argument("--hashtags", default="", help="comma-separated, no leading #")
    p.add_argument("--image-quality", choices=["low", "medium", "high"], default="medium")
    p.add_argument("--video-resolution", choices=["480p", "720p"], default="480p")
    p.add_argument("--scene-max-duration-sec", type=int, default=5)
    p.add_argument("--tts-style-directions", default=None)
    p.set_defaults(handler=h_niches_create)

    p = niches.add_parser("archive")
    p.add_argument("id")
    p.set_defaults(handler=h_niches_archive)

    # jobs
    jobs = sub.add_parser("jobs", help="manage jobs").add_subparsers(
        dest="cmd", required=True
    )
    p = jobs.add_parser("list")
    p.add_argument("--status", default=None,
                   help="queued|ideating|...|done|failed")
    p.add_argument("--limit", type=int, default=50)
    _add_json_flag(p)
    p.set_defaults(handler=h_jobs_list)

    p = jobs.add_parser("get")
    p.add_argument("id")
    p.set_defaults(handler=h_jobs_get)

    p = jobs.add_parser("enqueue")
    p.add_argument("--niche", required=True)
    p.add_argument("--platform", required=True, choices=PLATFORMS)
    p.set_defaults(handler=h_jobs_enqueue)

    p = jobs.add_parser("retry")
    p.add_argument("id")
    p.set_defaults(handler=h_jobs_retry)

    # spend

    articles = sub.add_parser("articles", help="manage SEO articles").add_subparsers(
        dest="cmd", required=True
    )
    p = articles.add_parser("list")
    p.add_argument("--status", default=None)
    p.add_argument("--niche", default=None)
    p.add_argument("--limit", type=int, default=50)
    p.add_argument("--json", action="store_true")
    p.set_defaults(handler=h_articles_list)

    p = articles.add_parser("get")
    p.add_argument("id")
    p.set_defaults(handler=h_articles_get)

    p = articles.add_parser("markdown")
    p.add_argument("id")
    p.set_defaults(handler=h_articles_markdown)

    p = articles.add_parser("generate")
    p.add_argument("--niche", required=True)
    p.add_argument("--topic", default="")
    p.set_defaults(handler=h_articles_generate)

    p = articles.add_parser("retry")
    p.add_argument("id")
    p.set_defaults(handler=h_articles_retry)

    spend = sub.add_parser("spend", help="spend").add_subparsers(dest="cmd", required=True)
    p = spend.add_parser("today")
    _add_json_flag(p)
    p.set_defaults(handler=h_spend_today)

    # connect
    connect = sub.add_parser("connect", help="connect external services").add_subparsers(
        dest="cmd", required=True
    )
    p = connect.add_parser("ayrshare")
    p.set_defaults(handler=h_connect_ayrshare)

    # tokens
    tokens = sub.add_parser("tokens", help="manage personal access tokens").add_subparsers(
        dest="cmd", required=True
    )
    p = tokens.add_parser("list")
    _add_json_flag(p)
    p.set_defaults(handler=h_tokens_list)

    p = tokens.add_parser("create")
    p.add_argument("--name", required=True)
    p.add_argument("--expires-in-days", type=int, default=None)
    p.set_defaults(handler=h_tokens_create)

    p = tokens.add_parser("revoke")
    p.add_argument("id")
    p.set_defaults(handler=h_tokens_revoke)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if _check_env() is None:
        print(
            f"error: {ENV_BASE_URL} and {ENV_TOKEN} must both be set in the environment.",
            file=sys.stderr,
        )
        return 2

    try:
        asyncio.run(_run(args.handler, args))
    except MarketerError as e:
        print(f"api error: {e}", file=sys.stderr)
        return 1
    except RuntimeError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
