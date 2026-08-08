"""Keyword-driven stock-footage lookup — the AI-B-roll port.

Two halves, both of which the source notebook did in-line:

1. **Keywords.** One LLM call turns a batch of beats into one search
   keyword each, as strict JSON ``[{"k": keyword, "i": index}]`` with no
   index skipped. `parse_keyword_batch` is pure and reproduces the
   notebook's tolerance for a model that wraps its JSON in a ```json
   fence — that fallback is not decoration, it is the common case for
   chat models asked for "strictly JSON".
2. **Footage.** The keyword is searched on Pexels, the best-fitting
   rendition is chosen deterministically, and the file is downloaded
   after an SSRF check.

Vendor discipline (same shape as `services/pixabay_music`)
----------------------------------------------------------
The low-level calls raise `PexelsError` — including for a missing key —
so a misconfiguration is loud where it is a bug. The high-level
`find_clip`/`fetch_clip` wrappers, which is what the pipeline actually
uses, return ``None`` for *every* failure including "no key configured".
An unkeyed deployment must degrade to generated b-roll, not fail a
render the user already paid a voiceover for.

Why the keyword call is batched
-------------------------------
`KEYWORD_BATCH_SIZE` beats per call, not one call per beat. That is a
**cost decision, not a style preference**: the per-call overhead (system
prompt + instructions, ~250 tokens) dominates the per-beat payload, so
one call per beat multiplies LLM spend by the beat count for identical
output. Batching also keeps the fan-out bounded — a 16-beat project is
one LLM call, not sixteen.
"""
from __future__ import annotations

import asyncio
import json
import re
import shutil
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path

import httpx

from ..config import settings
from ..logging import get_logger
from ..services.spend_context import SpendContext
from ..services.ssrf import check_public_url
from .broll import concrete_terms

log = get_logger(__name__)

PROVIDER = "pexels"
SKU_SEARCH = "video-search"

_SEARCH_URL = "https://api.pexels.com/videos/search"
_TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=5.0)

# One call per this many beats. See "Why the keyword call is batched".
KEYWORD_BATCH_SIZE = 20

# A stock clip is downloaded onto the artifacts volume before ffmpeg sees
# it. Vendors occasionally serve a 4K master for a 6-second beat; refuse
# rather than fill the volume.
MAX_CLIP_BYTES = 120_000_000
# Renditions narrower than this look soft once cover-cropped to 1080-wide.
MIN_RENDITION_WIDTH = 720

MAX_KEYWORD_CHARS = 60
# Keywords are LLM-authored and end up in a URL query, a persisted row,
# and (via styles.stock_query) a log line. Keep them to plain words.
_KEYWORD_ALLOWED = re.compile(r"[^A-Za-z0-9 '\-]+")
_WS = re.compile(r"\s+")
_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)

ORIENTATION_BY_ASPECT: dict[str, str] = {
    "9:16": "portrait",
    "16:9": "landscape",
    "1:1": "square",
}


class PexelsError(RuntimeError):
    """Raised for a missing key or a non-2xx response from Pexels."""

    def __init__(self, status_code: int, detail: str) -> None:
        self.status_code = status_code
        super().__init__(f"Pexels API error {status_code}: {detail}")


@dataclass(frozen=True)
class StockClip:
    """One downloadable footage rendition."""

    id: int
    url: str
    width: int
    height: int
    duration: float
    thumbnail: str = ""
    author: str = ""

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "url": self.url,
            "width": self.width,
            "height": self.height,
            "duration": self.duration,
            "thumbnail": self.thumbnail,
            "author": self.author,
        }


def api_key() -> str:
    """The configured Pexels key, or "".

    Read with `getattr` because `Settings` is the lead's file: the
    setting is named ``pexels_api_key`` (env ``MARKETER_PEXELS_API_KEY``)
    and this module works both before and after it is declared there,
    treating "not declared" exactly like "not set" — which is the
    degradation path this module is built around anyway.
    """
    return getattr(settings, "pexels_api_key", "") or ""


def enabled() -> bool:
    """True when a Pexels key is configured.

    Callers use this to choose a sourcing strategy *before* spending
    anything — an unkeyed deployment should never buy the keyword call
    for footage it cannot then fetch.
    """
    return bool(api_key())


def orientation_for(aspect: str) -> str:
    return ORIENTATION_BY_ASPECT.get(aspect, "portrait")


# ---------------------------------------------------------------------------
# Keywords (pure)
# ---------------------------------------------------------------------------


def sanitize_keyword(raw: object, *, max_chars: int = MAX_KEYWORD_CHARS) -> str:
    """Coerce a model-authored keyword into a plain search phrase."""
    text = raw if isinstance(raw, str) else ("" if raw is None else str(raw))
    cleaned = _WS.sub(" ", _KEYWORD_ALLOWED.sub(" ", text)).strip()
    return cleaned[:max_chars].strip()


def fallback_keyword(text: str) -> str:
    """Deterministic local keyword for a beat, used when the model skips it.

    Takes the two most distinctive concrete terms in the beat (the same
    vocabulary `broll.visual_score` ranks with), longest first. Never
    returns an empty string for non-empty input, because a beat with no
    keyword is a beat with no footage and therefore a hole in the plan.
    """
    terms = concrete_terms(text)
    if not terms:
        words = [w for w in _WS.split(_KEYWORD_ALLOWED.sub(" ", text or "")) if w]
        return sanitize_keyword(" ".join(words[:2]))
    ranked = sorted(dict.fromkeys(terms), key=lambda w: (-len(w), w))[:2]
    # Restore source order so the phrase reads naturally ("coffee beans",
    # not "beans coffee").
    ordered = [w for w in dict.fromkeys(terms) if w in ranked]
    return sanitize_keyword(" ".join(ordered))


def _json_candidates(raw: str) -> list[str]:
    """Every substring of a model reply that might be the JSON array.

    Order matters: the raw text first (a well-behaved model), then any
    fenced block (the notebook's ```json fallback), then a bracket-slice
    (a model that wrapped the array in prose).
    """
    text = (raw or "").strip()
    candidates = [text]
    candidates.extend(m.strip() for m in _FENCE.findall(text))
    start, end = text.find("["), text.rfind("]")
    if start != -1 and end > start:
        candidates.append(text[start : end + 1])
    return [c for c in candidates if c]


def parse_keyword_batch(raw: str, *, offset: int = 0, size: int | None = None) -> dict[int, str]:
    """Parse one batch reply into ``{global_beat_index: keyword}``.

    `offset` is the batch's first global index (the notebook's
    ``20*i + x["i"]``). Items with an unusable index or an empty keyword
    are dropped; when `size` is given, indices outside the batch are
    dropped too, so a hallucinated index can never overwrite another
    batch's beat. Returns ``{}`` rather than raising when nothing parses
    — the caller fills the gaps deterministically.
    """
    parsed: object = None
    for candidate in _json_candidates(raw):
        try:
            parsed = json.loads(candidate)
        except (ValueError, TypeError):
            continue
        if isinstance(parsed, (list, dict)):
            break
        parsed = None
    if isinstance(parsed, dict):  # {"keywords": [...]} is a common drift
        for key in ("keywords", "results", "data", "items"):
            if isinstance(parsed.get(key), list):
                parsed = parsed[key]
                break
    if not isinstance(parsed, list):
        return {}

    out: dict[int, str] = {}
    for item in parsed:
        if not isinstance(item, dict):
            continue
        try:
            local = int(item.get("i", item.get("index")))
        except (TypeError, ValueError):
            continue
        if local < 0 or (size is not None and local >= size):
            continue
        keyword = sanitize_keyword(item.get("k", item.get("keyword")))
        if not keyword:
            continue
        out.setdefault(offset + local, keyword)
    return out


BROLL_KEYWORD_INSTRUCTIONS = """You pick stock-footage search keywords for
a narrated short-form video.

Input JSON: {"segments": [{"i": <index>, "text": <narration>}, ...]}

For EACH segment return ONE search keyword that would retrieve b-roll
footage complementing what is being said, on a stock-footage site
(Pexels). Rules:

- One entry per input segment. NEVER skip an index, and return them in
  order, from the lowest "i" to the highest.
- Use the index from the input verbatim — do not renumber.
- A keyword is 1-3 plain words naming something a camera can film: a
  concrete object, place, action or material. "sunrise over city",
  "pouring coffee", "hands typing".
- Never return abstract nouns ("success", "strategy", "value"), brand
  names, proper nouns, quotes, punctuation, or hashtags — stock search
  returns nothing useful for them. Pick the most filmable thing the
  segment implies instead.
- Output STRICTLY a JSON array and nothing else.

Output format: [{"k": "keyword one", "i": 0}, {"k": "keyword two", "i": 1}]
"""


def build_keyword_agent():
    """The batched-keyword agent (plain-text output on purpose).

    The reply is parsed by `parse_keyword_batch` rather than by a
    structured output type, because the notebook's real-world failure
    mode — a fenced ```json block — is exactly what a schema-constrained
    decode would hide behind a hard error on some backends. Parsing
    leniently and filling gaps deterministically keeps a render alive.
    """
    from agents import Agent

    return Agent(
        model=settings.agent_model,
        name="BrollKeywords",
        instructions=BROLL_KEYWORD_INSTRUCTIONS,
    )


def batches(items: list, size: int) -> list[list]:
    """Split into fixed-size chunks (the notebook's `split_array`)."""
    step = max(int(size), 1)
    return [items[i : i + step] for i in range(0, len(items), step)]


async def keywords_for_beats(
    beats,
    *,
    spend: SpendContext | None = None,
    batch_size: int = KEYWORD_BATCH_SIZE,
) -> dict[int, str]:
    """``{beat.index: keyword}`` for every beat handed in.

    One metered LLM call per `batch_size` beats — see the module
    docstring: the batching is a cost decision, not a style one. Every
    beat is guaranteed a keyword: anything the model skipped, mangled,
    or returned out of range is filled by `fallback_keyword`, so the
    caller never has to reason about holes.
    """
    if not beats:
        return {}

    from ..agents.metered import run_metered

    agent = build_keyword_agent()
    resolved: dict[int, str] = {}
    ordered = list(beats)

    for offset in range(0, len(ordered), max(int(batch_size), 1)):
        chunk = ordered[offset : offset + max(int(batch_size), 1)]
        payload = {
            "segments": [
                {"i": local, "text": beat.text} for local, beat in enumerate(chunk)
            ]
        }
        try:
            result = await run_metered(agent, json.dumps(payload), spend=spend)
            raw = str(getattr(result, "final_output", "") or "")
            parsed = parse_keyword_batch(raw, offset=offset, size=len(chunk))
        except Exception as exc:  # noqa: BLE001 — see below
            from ..repos.spend import SpendCapExceeded

            if isinstance(exc, SpendCapExceeded):
                raise  # a tripped cap must stop the run, not degrade it
            # Any other failure degrades to local keywords: the narration
            # itself is a perfectly serviceable source of search terms,
            # and losing footage variety beats losing the render.
            log.warning(
                "motion.stock.keywords_failed",
                extra={"offset": offset, "error": str(exc)[:200]},
            )
            parsed = {}

        for local, beat in enumerate(chunk):
            keyword = parsed.get(offset + local) or fallback_keyword(beat.text)
            resolved[beat.index] = keyword

    return resolved


# ---------------------------------------------------------------------------
# Pexels (I/O)
# ---------------------------------------------------------------------------


def _pick_rendition(files: list[dict]) -> dict | None:
    """Deterministically choose one rendition from a Pexels video.

    The notebook took ``video_files[0]``, whose position is not
    stable — it can be a 4K master or a 240p proxy depending on the
    item. We take the *narrowest rendition still wide enough* to survive
    a cover-crop to 1080, falling back to the widest available, with the
    file id breaking ties so the same search always yields the same
    bytes (a reproducible render).
    """
    usable = [
        f
        for f in files
        if isinstance(f, dict) and f.get("link") and int(f.get("width") or 0) > 0
    ]
    if not usable:
        return None
    big_enough = [f for f in usable if int(f["width"]) >= MIN_RENDITION_WIDTH]
    pool = big_enough or usable
    key = (lambda f: (int(f["width"]), int(f.get("id") or 0))) if big_enough else (
        lambda f: (-int(f["width"]), int(f.get("id") or 0))
    )
    return min(pool, key=key)


def _to_clips(payload: dict) -> list[StockClip]:
    clips: list[StockClip] = []
    for video in payload.get("videos") or []:
        if not isinstance(video, dict):
            continue
        rendition = _pick_rendition(video.get("video_files") or [])
        if rendition is None:
            continue
        clips.append(
            StockClip(
                id=int(video.get("id") or 0),
                url=str(rendition["link"]),
                width=int(rendition.get("width") or 0),
                height=int(rendition.get("height") or 0),
                duration=float(video.get("duration") or 0.0),
                thumbnail=str(video.get("image") or ""),
                author=str(video.get("user", {}).get("name") or ""),
            )
        )
    return clips


async def search(
    query: str,
    *,
    orientation: str = "portrait",
    per_page: int = 5,
    spend: SpendContext | None = None,
) -> list[StockClip]:
    """Search Pexels videos. Raises `PexelsError` when unconfigured or 4xx/5xx.

    Metered like every other provider call. Pexels does not charge, so
    the ledger row is zero-cost — it exists for attribution (which
    project pulled which vendor) and so an unexpected vendor bill would
    show up in the same place as every other one.
    """
    key = api_key()
    if not key:
        raise PexelsError(0, "pexels_api_key is not configured")

    params = {
        "query": query,
        "orientation": orientation,
        "size": "medium",
        "per_page": str(max(1, min(int(per_page), 20))),
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        response = await client.get(
            _SEARCH_URL, params=params, headers={"Authorization": key}
        )

    if response.status_code in (401, 403):
        raise PexelsError(response.status_code, "invalid API key")
    if response.status_code == 429:
        raise PexelsError(429, "rate limit exceeded")
    if response.status_code >= 500:
        raise PexelsError(response.status_code, "upstream server error")
    if not response.is_success:
        raise PexelsError(response.status_code, response.text[:200])

    clips = _to_clips(response.json())
    if spend is not None:
        await spend.log(
            provider=PROVIDER, sku=SKU_SEARCH, units=Decimal(1), cost_usd=Decimal(0)
        )
    log.info(
        "motion.stock.search",
        extra={"query": query, "orientation": orientation, "returned": len(clips)},
    )
    return clips


async def find_clip(
    query: str,
    *,
    orientation: str = "portrait",
    min_duration: float = 0.0,
    spend: SpendContext | None = None,
) -> StockClip | None:
    """Best clip for `query`, or ``None`` — never raises.

    This is the wrapper the pipeline calls, and it is the reason an
    unkeyed deployment still renders: no key, no results, a rate limit,
    or a vendor outage all resolve to "this beat has no stock footage",
    which the plan already knows how to fall back from.
    """
    if not enabled():
        return None
    try:
        clips = await search(query, orientation=orientation, spend=spend)
    except PexelsError as exc:
        log.warning("motion.stock.unavailable", extra={"query": query, "error": str(exc)})
        return None
    except Exception as exc:  # noqa: BLE001 — enrichment, never fatal
        from ..repos.spend import SpendCapExceeded

        if isinstance(exc, SpendCapExceeded):
            raise
        log.warning("motion.stock.search_failed", extra={"query": query, "error": str(exc)})
        return None
    if not clips:
        return None
    # Prefer a clip long enough to cover the beat without looping, but
    # never fail over it — `broll.stock_fit_filter` loops short footage.
    long_enough = [c for c in clips if c.duration >= min_duration > 0]
    return (long_enough or clips)[0]


async def download(clip: StockClip, dest: Path) -> Path | None:
    """Fetch one clip to `dest`, or ``None`` if it can't be trusted/fetched.

    The URL comes from a third party and is fetched server-side, so it
    gets the same public-address check as a user-registered webhook
    before a socket is opened (`services/ssrf.check_public_url`, which
    does DNS and therefore runs off-thread). Downloads to a sibling
    ``.part`` and renames, so a killed container cannot leave a truncated
    clip behind for a resume to reuse.
    """
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    ok, reason = await asyncio.to_thread(check_public_url, clip.url)
    if not ok:
        log.warning("motion.stock.url_rejected", extra={"url": clip.url, "reason": reason})
        return None

    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    written = 0
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=False) as client:
            async with client.stream("GET", clip.url) as response:
                if not response.is_success:
                    raise PexelsError(response.status_code, f"download failed: {clip.url}")
                with tmp.open("wb") as fh:
                    async for chunk in response.aiter_bytes(chunk_size=65536):
                        written += len(chunk)
                        if written > MAX_CLIP_BYTES:
                            raise PexelsError(0, f"clip exceeds {MAX_CLIP_BYTES} bytes")
                        fh.write(chunk)
    except Exception as exc:  # noqa: BLE001 — a missing clip degrades, never fails
        tmp.unlink(missing_ok=True)
        log.warning("motion.stock.download_failed", extra={"url": clip.url, "error": str(exc)})
        return None

    if written == 0:
        tmp.unlink(missing_ok=True)
        return None
    shutil.move(str(tmp), str(dest))
    return dest


async def fetch_clip(
    query: str,
    dest: Path,
    *,
    orientation: str = "portrait",
    min_duration: float = 0.0,
    spend: SpendContext | None = None,
) -> StockClip | None:
    """`find_clip` + `download` as one graceful step (returns None on miss)."""
    clip = await find_clip(
        query, orientation=orientation, min_duration=min_duration, spend=spend
    )
    if clip is None:
        return None
    return clip if await download(clip, dest) is not None else None


__all__ = [
    "BROLL_KEYWORD_INSTRUCTIONS",
    "KEYWORD_BATCH_SIZE",
    "ORIENTATION_BY_ASPECT",
    "PexelsError",
    "StockClip",
    "api_key",
    "batches",
    "build_keyword_agent",
    "download",
    "enabled",
    "fallback_keyword",
    "fetch_clip",
    "find_clip",
    "keywords_for_beats",
    "orientation_for",
    "parse_keyword_batch",
    "sanitize_keyword",
    "search",
]
