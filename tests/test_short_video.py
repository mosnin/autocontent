"""Short video (docs/short-video.md): footage search and attribution, upload
validation, composition parameters, subtitle timing, metering, batches under
caps, routes and permissions. Everything runs on fakes: no network, no ffmpeg,
no provider keys."""
from __future__ import annotations

import json
import sys
import types
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from marketer.models import SpendEntry
from marketer.short_video import captions, edit_plan, keywords, pricing, render, stock, uploads
from marketer.short_video.metering import (
    SKIPPED,
    BatchCapExceeded,
    IndeterminateCharge,
    MemoryChargeStore,
    Meter,
    charge_key,
    micros_to_usd,
    usd_to_micros,
)
from marketer.short_video.models import (
    ShortVideoBatch,
    ShortVideoItem,
    ShortVideoRequest,
    ShortVideoSettings,
    StockClip,
    SubtitleSettings,
)
from marketer.services.spend_context import SpendContext
from tests.auth_helpers import ctx_for

USER = "user_sv"

# --------------------------------------------------------------- fixtures

PEXELS = {
    "videos": [
        {
            "id": 101, "url": "https://www.pexels.com/video/coffee-101/", "duration": 12,
            "user": {"name": "Ana Lima", "url": "https://www.pexels.com/@ana"},
            "video_files": [
                {"id": 1, "file_type": "video/mp4", "width": 2160, "height": 3840, "link": "https://videos.pexels.com/video-files/101/4k.mp4"},
                {"id": 2, "file_type": "video/mp4", "width": 1080, "height": 1920, "link": "https://videos.pexels.com/video-files/101/hd.mp4"},
                {"id": 3, "file_type": "video/mp4", "width": 360, "height": 640, "link": "https://videos.pexels.com/video-files/101/sd.mp4"},
            ],
        },
        {  # landscape only: no rendition fills a portrait canvas
            "id": 102, "url": "https://www.pexels.com/video/x-102/", "duration": 20, "user": {"name": "B"},
            "video_files": [{"id": 4, "file_type": "video/mp4", "width": 1920, "height": 1080, "link": "https://videos.pexels.com/video-files/102/hd.mp4"}],
        },
        {"id": 103, "duration": 1, "video_files": []},  # too short
        "garbage",
    ]
}

PIXABAY = {
    "hits": [
        {
            "id": 7, "pageURL": "https://pixabay.com/videos/id-7/", "duration": 9, "user": "kai", "user_id": 55,
            "videos": {
                "large": {"url": "https://cdn.pixabay.com/video/7/large.mp4", "width": 2160, "height": 3840},
                "medium": {"url": "https://cdn.pixabay.com/video/7/medium.mp4", "width": 1080, "height": 1920},
                "tiny": {"url": "https://cdn.pixabay.com/video/7/tiny.mp4", "width": 360, "height": 640},
            },
        }
    ]
}


def _transport(counter: dict) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        counter[request.url.host] = counter.get(request.url.host, 0) + 1
        if request.url.host == "api.pexels.com":
            assert request.headers["Authorization"] == "pexels-key"
            assert request.url.params["orientation"] == "portrait"
            return httpx.Response(200, json=PEXELS)
        if request.url.host == "pixabay.com":
            assert request.url.params["key"] == "pixabay-key"
            return httpx.Response(200, json=PIXABAY)
        return httpx.Response(404)

    return httpx.MockTransport(handler)


@pytest.fixture
def keys(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "pexels_api_key", "pexels-key")
    monkeypatch.setattr(settings, "pixabay_api_key", "pixabay-key")


# ---------------------------------------------------- footage + attribution

def test_parse_pexels_picks_smallest_filling_rendition_and_keeps_attribution():
    clips = stock.parse_pexels(PEXELS, query="coffee pour", aspect="9:16", min_duration=3)
    assert [c.provider_id for c in clips] == ["101"]
    c = clips[0]
    assert (c.width, c.height) == (1080, 1920)
    assert c.download_url.endswith("/hd.mp4")
    assert c.creator == "Ana Lima" and c.creator_url == "https://www.pexels.com/@ana"
    assert c.licence == "Pexels License" and c.licence_url == "https://www.pexels.com/license/"
    assert c.page_url == "https://www.pexels.com/video/coffee-101/"
    assert c.attribution() == "Video by Ana Lima on Pexels (Pexels License)"


def test_parse_pixabay_attribution_and_square_accepts_either_orientation():
    clips = stock.parse_pixabay(PIXABAY, query="beach", aspect="9:16", min_duration=3)
    assert clips[0].download_url.endswith("medium.mp4")
    assert clips[0].licence == "Pixabay Content License"
    assert clips[0].creator_url == "https://pixabay.com/users/kai-55/"
    land = stock.parse_pexels(PEXELS, query="x", aspect="1:1", min_duration=3)
    assert {c.provider_id for c in land} == {"101", "102"}


async def test_search_interleaves_providers_dedupes_and_caches(keys):
    counter: dict = {}
    cache = stock.MemoryCache()
    async with httpx.AsyncClient(transport=_transport(counter)) as client:
        clips = await stock.search([(0, "coffee"), (1, "coffee")], sources=["pexels", "pixabay"],
                                   aspect="9:16", client=client, cache=cache)
        # Segment 1 asked the same term: served from the cache, deduped by id.
        assert counter == {"api.pexels.com": 1, "pixabay.com": 1}
    assert [(c.provider, c.segment) for c in clips] == [("pexels", 0), ("pixabay", 0)]
    assert all(c.query == "coffee" for c in clips)
    assert ("pexels", "coffee", "portrait") in cache.rows


async def test_search_skips_provider_without_key_and_survives_errors(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "pexels_api_key", "")
    monkeypatch.setattr(settings, "pixabay_api_key", "k")

    def handler(request):
        return httpx.Response(429)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        assert await stock.search([(0, "x")], sources=["pexels", "pixabay"], aspect="9:16", client=client) == []
    assert stock.configured_sources() == ["pixabay"]


def test_downloads_only_from_provider_hosts():
    ok = StockClip(provider="pixabay", provider_id="1", download_url="https://cdn.pixabay.com/v.mp4")
    assert stock.download_allowed(ok)
    for bad in ("https://evil.example/v.mp4", "http://cdn.pixabay.com/v.mp4", "https://cdn.pixabay.com.evil.io/v.mp4"):
        assert not stock.download_allowed(ok.model_copy(update={"download_url": bad}))
    assert not stock.download_allowed(ok.model_copy(update={"provider": "pexels"}))


async def test_download_writes_cache_file_and_refuses_oversize(tmp_path, monkeypatch):
    clip = StockClip(provider="pexels", provider_id="9", width=1080, height=1920,
                     download_url="https://videos.pexels.com/video-files/9/hd.mp4")
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(200, content=b"x" * 1000)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        p = await stock.download(clip, tmp_path, client=client)
        assert p.read_bytes() == b"x" * 1000
        await stock.download(clip, tmp_path, client=client)  # cached
        assert calls["n"] == 1
        monkeypatch.setattr(stock, "MAX_DOWNLOAD_BYTES", 10)
        big = clip.model_copy(update={"provider_id": "10"})
        with pytest.raises(stock.StockError):
            await stock.download(big, tmp_path, client=client)
        assert not stock.cache_path(big, tmp_path).exists()


def test_keywords_from_script_segments():
    script = ("Most people brew coffee wrong. The water temperature matters more than the beans. "
              "Try a pour over at home and taste the difference in Lisbon style.")
    segs = keywords.split_segments(script)
    assert len(segs) == 3
    terms = keywords.search_terms(script)
    assert [i for i, _ in terms][:3] == [0, 1, 2]
    flat = " ".join(t for _, t in terms)
    assert "coffee" in flat and "water" in flat
    assert all(len(t.split()) <= 2 for _, t in terms)
    assert keywords.clean_term("  Coffee, Pour!! <script> ") == "coffee pour script"


# ------------------------------------------------------------ upload checks

def test_declared_type_and_size_limits():
    assert uploads.validate_declared("video/mp4", 1000) == "video"
    assert uploads.validate_declared("image/png; charset=x", 1000) == "image"
    for ct, size in (("application/pdf", 10), ("text/html", 10), ("image/png", 16 * 1024 * 1024),
                     ("video/mp4", 201 * 1024 * 1024), ("video/mp4", 0)):
        with pytest.raises(uploads.UploadRejected):
            uploads.validate_declared(ct, size)


def test_sniff_magic_bytes():
    assert uploads.sniff(b"\xff\xd8\xff\xe0" + b"0" * 8) == "image/jpeg"
    assert uploads.sniff(b"\x89PNG\r\n\x1a\n") == "image/png"
    assert uploads.sniff(b"RIFF1234WEBPVP8 ") == "image/webp"
    assert uploads.sniff(b"\x00\x00\x00\x18ftypisom") == "video/mp4"
    assert uploads.sniff(b"\x00\x00\x00\x14ftypqt  ") == "video/quicktime"
    assert uploads.sniff(b"<html><script>") is None
    assert uploads.sniff_matches("video/quicktime", "video/mp4")
    assert not uploads.sniff_matches("image/png", "image/jpeg")


def test_probe_rules():
    good = {"streams": [{"codec_type": "video", "width": 1080, "height": 1920}], "format": {"duration": "12.5"}}
    assert uploads.check_probe("video", good).duration_sec == 12.5
    assert uploads.check_probe("image", {"streams": [{"codec_type": "video", "width": 800, "height": 800}]}).width == 800
    bad = [
        {"streams": [{"codec_type": "audio"}]},
        {"streams": [{"codec_type": "video", "width": 200, "height": 300}], "format": {"duration": "3"}},
        {"streams": [{"codec_type": "video", "width": 1080, "height": 1920}], "format": {"duration": "600"}},
        {"streams": [{"codec_type": "video", "width": 1080, "height": 1920}], "format": {"duration": "0.2"}},
    ]
    for b in bad:
        with pytest.raises(uploads.UploadRejected):
            uploads.check_probe("video", b)


async def test_verify_stored_checks_size_magic_and_probe(tmp_path):
    payload = b"\x00\x00\x00\x18ftypisom" + b"\x00" * 100

    async def size_of(key):
        return len(payload)

    async def fetch(key, local):
        local.write_bytes(payload)
        return local

    probe = lambda p: {"streams": [{"codec_type": "video", "width": 720, "height": 1280}], "format": {"duration": "4"}}  # noqa: E731
    r = await uploads.verify_stored(key="u/a.mp4", kind="video", content_type="video/mp4", declared_size=len(payload),
                                    workdir=tmp_path, size_of=size_of, fetch=fetch, probe=probe)
    assert (r.width, r.height, r.duration_sec) == (720, 1280, 4.0)
    assert not (tmp_path / "a.mp4").exists()  # the local copy is removed

    with pytest.raises(uploads.UploadRejected, match="match what was declared"):
        await uploads.verify_stored(key="u/a.mp4", kind="video", content_type="video/mp4", declared_size=5,
                                    workdir=tmp_path, size_of=size_of, fetch=fetch, probe=probe)

    async def fetch_html(key, local):
        local.write_bytes(b"<html>" + b"0" * (len(payload) - 6))
        return local

    with pytest.raises(uploads.UploadRejected, match="contents"):
        await uploads.verify_stored(key="u/a.mp4", kind="video", content_type="video/mp4", declared_size=len(payload),
                                    workdir=tmp_path, size_of=size_of, fetch=fetch_html, probe=probe)


# --------------------------------------------------- composition parameters

def _sources(n=3, dur=10.0):
    return [edit_plan.Source(f"/f/{i}.mp4", dur, "video", segment=i) for i in range(n)]


def test_plan_covers_narration_with_margin_and_respects_clip_length():
    slices = edit_plan.plan(_sources(), audio_duration=20.0, clip_duration=4.0, seed=1)
    assert edit_plan.total_length(slices) >= 20.0 + edit_plan.SAFETY_MARGIN_SEC
    assert all(s.out_len <= 4.0 + 1e-9 for s in slices)
    # Random order: every source appears before any repeats.
    first = [s.path for s in slices[:3]]
    assert sorted(first) == ["/f/0.mp4", "/f/1.mp4", "/f/2.mp4"]


def test_plan_speed_reads_longer_source_slices_and_keeps_timeline_continuous():
    slices = edit_plan.plan(_sources(1, 30.0), audio_duration=12.0, clip_duration=4.0, speed=2.0,
                            order="sequential", seed=0)
    assert slices[0].source_len == 8.0 and slices[0].out_len == 4.0
    assert [s.start for s in slices[:3]] == [0.0, 8.0, 16.0]


def test_plan_sequential_follows_script_order_then_rounds():
    srcs = [edit_plan.Source("/b.mp4", 8, segment=1), edit_plan.Source("/a.mp4", 8, segment=0)]
    slices = edit_plan.plan(srcs, audio_duration=14.0, clip_duration=4.0, order="sequential")
    assert [s.path for s in slices] == ["/a.mp4", "/b.mp4", "/a.mp4", "/b.mp4"]


def test_plan_loops_short_footage_and_is_seeded():
    slices = edit_plan.plan(_sources(1, 3.0), audio_duration=10.0, clip_duration=4.0)
    assert len(slices) >= 4 and len({s.path for s in slices}) == 1
    a = edit_plan.plan(_sources(5), audio_duration=20, seed=7, transition="shuffle")
    b = edit_plan.plan(_sources(5), audio_duration=20, seed=7, transition="shuffle")
    c = edit_plan.plan(_sources(5), audio_duration=20, seed=8, transition="shuffle")
    assert a == b and a != c
    with pytest.raises(ValueError):
        edit_plan.plan([], audio_duration=10)


def test_slice_argv_crop_letterbox_speed_and_fades(tmp_path):
    s = edit_plan.Slice("/f/a.mp4", "video", 2.0, 8.0, 4.0, transition="fade")
    argv = render.slice_argv(s, tmp_path / "o.mp4", aspect="9:16", fit="crop")
    vf = argv[argv.index("-vf") + 1]
    assert argv[:6] == ["-ss", "2.000", "-t", "8.000", "-i", "/f/a.mp4"]
    assert vf.startswith("setpts=PTS/2.0000,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920")
    assert "fade=t=in:st=0:d=0.5" in vf and "fade=t=out:st=3.5:d=0.5" in vf
    assert argv[argv.index("-t", 5) + 1] == "4.000" and "-an" in argv

    lb = render.slice_argv(s, tmp_path / "o.mp4", aspect="16:9", fit="letterbox")
    vf2 = lb[lb.index("-vf") + 1]
    assert "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black" in vf2

    img = edit_plan.Slice("/f/p.png", "image", 0.0, 3.0, 3.0, transition="none")
    ia = render.slice_argv(img, tmp_path / "i.mp4", aspect="1:1", fit="crop")
    assert ia[:2] == ["-loop", "1"] and "zoompan" in ia[ia.index("-vf") + 1] and "fade" not in ia[ia.index("-vf") + 1]
    with pytest.raises(ValueError):
        render.slice_argv(s, tmp_path / "o.mp4", aspect="4:3", fit="crop")


def test_mix_argv_ducking_volume_and_no_music(tmp_path):
    v, vo, m, out = Path("v.mp4"), Path("vo.wav"), Path("m.mp3"), Path("o.mp4")
    ducked = render.mix_argv(v, vo, m, out, duration=21.4, volume_db=-20.0, duck=True)
    fc = ducked[ducked.index("-filter_complex") + 1]
    assert "[2:a]volume=-20.0dB" in fc and "sidechaincompress" in fc
    assert ducked[ducked.index("-stream_loop") + 1] == "-1" and ducked[-3:] == ["-t", "21.400", "o.mp4"]
    plain = render.mix_argv(v, vo, m, out, duration=10, volume_db=-12, duck=False)
    assert "sidechaincompress" not in plain[plain.index("-filter_complex") + 1]
    silent = render.mix_argv(v, vo, None, out, duration=10, volume_db=-12, duck=True)
    assert "-filter_complex" not in silent and "1:a" in silent


def test_render_runners_dedupe_looped_slices(monkeypatch, tmp_path):
    from marketer.services import ffmpeg as ff

    cmds: list[list[str]] = []
    monkeypatch.setattr(ff, "_run", lambda cmd: cmds.append(cmd))
    s = edit_plan.Slice("/f/a.mp4", "video", 0.0, 4.0, 4.0)
    paths = render.render_slices([s, s, s], tmp_path, aspect="9:16", fit="crop")
    assert len(cmds) == 1 and len(paths) == 3
    render.concat(paths, tmp_path / "out.mp4", duration=12)
    listing = (tmp_path / "out.txt").read_text()
    assert listing.count("file '") == 3
    assert cmds[-1][cmds[-1].index("-f") + 1] == "concat"


# ------------------------------------------------------------ subtitle timing

WORDS = [
    {"word": "most", "start": 0.0, "end": 0.3}, {"word": "people", "start": 0.3, "end": 0.6},
    {"word": "brew", "start": 0.6, "end": 0.9}, {"word": "coffee", "start": 0.9, "end": 1.3},
    {"word": "wrong", "start": 1.3, "end": 1.7},
    {"word": "try", "start": 2.6, "end": 2.8}, {"word": "aeropress", "start": 2.8, "end": 3.4},
    {"word": "in", "start": 3.4, "end": 3.5}, {"word": "twenty", "start": 3.5, "end": 3.8},
    {"word": "twenty", "start": 3.8, "end": 4.1},
]
SCRIPT = "Most people brew coffee wrong. Try AeroPress in 2020."


def test_align_takes_script_spelling_and_keeps_whisper_timing():
    aligned = captions.align_to_script(WORDS, SCRIPT)
    texts = [w.text for w in aligned]
    assert texts[:7] == ["Most", "people", "brew", "coffee", "wrong.", "Try", "AeroPress"]
    assert aligned[6].start == 2.8 and aligned[6].end == 3.4
    # "twenty twenty" vs "2020.": no 1:1 match, whisper's words stay (timed) rather than vanish.
    assert texts[-2:] == ["twenty", "twenty"]


def test_cues_break_on_punctuation_pause_and_length():
    aligned = captions.align_to_script(WORDS, SCRIPT)
    cues = captions.build_cues(aligned, max_chars=14)
    assert cues[0].text == "Most people"
    assert any(c.text.endswith("wrong.") for c in cues)
    assert all(len(c.text) <= 14 or len(c.words) == 1 for c in cues)
    starts = [c.start for c in cues]
    assert starts == sorted(starts)


def test_srt_vtt_and_ass_highlight():
    cues = captions.build_cues(captions.align_to_script(WORDS[:5], "Most people brew coffee wrong."), max_chars=40)
    srt = captions.to_srt(cues)
    assert srt.startswith("1\n00:00:00,000 --> 00:00:01,700\nMost people brew coffee wrong.\n")
    vtt = captions.to_vtt(cues)
    assert vtt.startswith("WEBVTT\n\n00:00:00.000 --> 00:00:01.700\n")
    style = SubtitleSettings(mode="highlight", highlight_hex="FFD400", outline_px=7, uppercase=True, position="top")
    ass = captions.to_ass(cues, style, width=1080, height=1920)
    assert "Style: Default,Arial Black,84,&H00FFFFFF" in ass and ",7,2,8,80,80,153,1" in ass
    events = [line for line in ass.splitlines() if line.startswith("Dialogue")]
    assert len(events) == 5  # one per word, whole line shown each time
    assert "{\\c&H0000D4FF}MOST{\\r} PEOPLE" in events[0]
    word_mode = captions.to_ass(cues, SubtitleSettings(mode="word"), width=1080, height=1920)
    assert sum(1 for line in word_mode.splitlines() if line.startswith("Dialogue")) == 5
    sentence = captions.to_ass(cues, SubtitleSettings(mode="sentence"), width=1080, height=1920)
    assert sum(1 for line in sentence.splitlines() if line.startswith("Dialogue")) == 1


# ----------------------------------------------------------------- metering

def test_micro_dollars_are_integers_rounded_up():
    assert usd_to_micros(Decimal("0.0123451")) == 12346
    assert usd_to_micros("1") == 1_000_000
    assert isinstance(usd_to_micros(0.5), int)
    assert micros_to_usd(12346) == Decimal("0.012346")


def _spend(entries: list) -> SpendContext:
    async def record(e: SpendEntry) -> None:
        entries.append(e)

    return SpendContext(user_id=USER, niche_id=None, job_id=None, record=record)


async def test_meter_charges_once_per_key_and_records_micros():
    entries: list = []
    store = MemoryChargeStore()
    batch, item = uuid4(), uuid4()
    meter = Meter(spend=_spend(entries), store=store, batch_id=batch, cap_micros=1_000_000)
    calls = {"n": 0}

    async def paid(ctx):
        calls["n"] += 1
        await ctx.log(provider="openai", sku="tts", units=Decimal(1), cost_usd=Decimal("0.0213"))
        return "ok"

    key = charge_key(item, 1, "voice")
    assert await meter.charge(key, item_id=item, stage="voice", provider="openai", sku="tts", estimate_micros=1, call=paid) == "ok"
    assert await meter.charge(key, item_id=item, stage="voice", provider="openai", sku="tts", estimate_micros=1, call=paid) is SKIPPED
    assert calls["n"] == 1
    assert store.rows[key]["cost_micros"] == 21300 and store.rows[key]["status"] == "done"
    assert len(entries) == 1  # the real recorder (spend_ledger) saw it exactly once


async def test_meter_pending_key_is_indeterminate_and_cap_refuses_before_calling():
    store = MemoryChargeStore()
    batch, item = uuid4(), uuid4()
    meter = Meter(spend=_spend([]), store=store, batch_id=batch, cap_micros=100)
    await store.claim("k", user_id=USER, batch_id=batch, item_id=item, stage="voice", provider="p", sku="s")

    async def never(ctx):
        raise AssertionError("must not run")

    with pytest.raises(IndeterminateCharge):
        await meter.charge("k", item_id=item, stage="voice", provider="p", sku="s", estimate_micros=1, call=never)
    with pytest.raises(BatchCapExceeded):
        await meter.charge("k2", item_id=item, stage="voice", provider="p", sku="s", estimate_micros=101, call=never)
    # A refused key can run later (nothing was delivered).
    assert store.rows["k2"]["status"] == "failed"


def test_estimate_and_approval_threshold():
    small = pricing.estimate(ShortVideoRequest(topic="coffee myths"))
    assert small.total_micros == small.per_variant_micros > 0 and not small.needs_approval
    assert small.cap_micros == max(int(small.total_micros * 1.5), 100_000)
    many = pricing.estimate(ShortVideoRequest(topic="coffee myths", variants=4))
    assert many.needs_approval and many.total_micros == 4 * many.per_variant_micros
    script = pricing.estimate(ShortVideoRequest(source="script", script="one two three four five six"))
    assert "script" not in script.lines
    gen = ShortVideoRequest(topic="x y z", settings=ShortVideoSettings.model_validate({"music": {"mode": "generated"}}))
    assert "music" in pricing.estimate(gen).lines
    with pytest.raises(ValueError):
        ShortVideoRequest(topic="x", variants=11)
    with pytest.raises(ValueError):
        ShortVideoRequest(source="script", script="too short")


# ------------------------------------------------------------ batch + caps

class FakeRepo:
    def __init__(self, batch: ShortVideoBatch) -> None:
        self.batch = batch
        self.items = {i.id: i.model_dump() for i in batch.items}
        self.cancelled: set[UUID] = set()

    async def get_batch(self, batch_id, *, user_id):
        items = [ShortVideoItem.model_validate(self.items[i.id]) for i in self.batch.items]
        return self.batch.model_copy(update={"items": items})

    async def transition_batch(self, batch_id, *, user_id, from_status, to_status, **kw):
        if self.batch.status not in from_status:
            return False
        self.batch = self.batch.model_copy(update={"status": to_status})
        return True

    async def finish_batch(self, batch_id, *, user_id):
        st = [i["status"] for i in self.items.values()]
        final = "done" if all(s == "done" for s in st) else "partial" if "done" in st else "failed"
        self.batch = self.batch.model_copy(update={"status": final})
        return final

    async def update_item(self, item_id, *, user_id, **fields):
        self.items[item_id].update(fields)

    async def item_is_cancelled(self, item_id):
        return item_id in self.cancelled


def _batch(variants=3, cap=1_000_000, source="topic", settings=None) -> ShortVideoBatch:
    bid = uuid4()
    items = [ShortVideoItem(id=uuid4(), batch_id=bid, user_id=USER, variant=v) for v in range(1, variants + 1)]
    return ShortVideoBatch(id=bid, user_id=USER, source=source, topic="coffee myths",
                           script="Coffee is not dehydrating. Fresh beans matter. Grind right before you brew.",
                           settings=settings or ShortVideoSettings(), variants=variants, status="queued",
                           cap_micros=cap, items=items)


def _deps(repo: FakeRepo, tmp_path: Path, *, script_cost="0.01", log: list | None = None):
    from marketer.short_video import pipeline
    from marketer.short_video.script import Draft

    log = log if log is not None else []
    entries: list = []

    async def spend_for(b):
        return _spend(entries)

    async def brand(user_id):
        return "warm", ["cheap"]

    async def write_script(**kw):
        log.append(("script", kw["variant"]))
        await kw["spend"].log(provider="openai", sku="llm", units=Decimal(1), cost_usd=Decimal(script_cost))
        return Draft(hook=f"Hook {kw['variant']}", script="Coffee is not dehydrating. Fresh beans matter.",
                     terms=[(0, "coffee"), (1, "coffee beans")])

    async def synthesize(text, out, *, look, spend):
        log.append(("voice",))
        await spend.log(provider="openai", sku="tts", units=Decimal(1), cost_usd=Decimal("0.002"))
        out.write_bytes(b"RIFF")
        return out

    async def transcribe(path, *, spend):
        await spend.log(provider="openai", sku="whisper-1", units=Decimal(1), cost_usd=Decimal("0.001"))
        return [{"word": w, "start": i * 0.4, "end": i * 0.4 + 0.35} for i, w in
                enumerate("coffee is not dehydrating fresh beans matter".split())]

    async def search(terms, *, sources, aspect, min_duration):
        return [StockClip(provider="pexels", provider_id=f"{seg}{n}", duration_sec=8, segment=seg,
                          download_url="https://videos.pexels.com/x.mp4", creator="Ana", licence="Pexels License")
                for seg, _ in terms for n in range(3)]

    async def download(clip, root):
        return tmp_path / f"{clip.provider_id}.mp4"

    async def no_uploads(batch, work):
        return []

    async def library(**kw):
        return tmp_path / "music.mp3"

    async def compose(**kw):
        raise AssertionError("not used")

    async def archive(final, **kw):
        return uuid4()

    calls: dict[str, list] = {"mix": [], "burn": [], "slices": []}

    def render_slices(slices, work, *, aspect, fit):
        calls["slices"].append((len(slices), aspect, fit))
        return [work / f"{i}.mp4" for i in range(len(slices))]

    def concat(paths, out, *, duration):
        return out

    def mix(video, voice, music, out, **kw):
        calls["mix"].append((music, kw))
        return out

    def burn(video, ass, out):
        calls["burn"].append(ass)
        return out

    deps = pipeline.Deps(
        get_batch=repo.get_batch, transition_batch=repo.transition_batch, finish_batch=repo.finish_batch,
        update_item=repo.update_item, item_is_cancelled=repo.item_is_cancelled, charges=MemoryChargeStore(),
        spend_for=spend_for, brand=brand, write_script=write_script, synthesize=synthesize, transcribe=transcribe,
        search=search, download=download, uploads=no_uploads, probe_duration=lambda p: 3.0,
        pick_library_music=library, compose_music=compose, archive=archive,
        render_slices=render_slices, concat=concat, mix=mix, burn=burn, workdir_root=tmp_path,
    )
    return deps, calls, entries


async def test_batch_runs_every_variant_through_every_stage(tmp_path, monkeypatch):
    from marketer.config import settings
    from marketer.short_video import pipeline

    monkeypatch.setattr(settings, "assets_dir", str(tmp_path))
    repo = FakeRepo(_batch(variants=2))
    log: list = []
    deps, calls, entries = _deps(repo, tmp_path, log=log)
    assert await pipeline.run_batch(user_id=USER, batch_id=repo.batch.id, deps=deps) == "done"
    for item in repo.items.values():
        assert item["status"] == "done" and item["progress"] == 100
        assert [k for k, v in item["stages"].items() if v["state"] in ("done", "skipped")] == list(pipeline.STAGES)
        assert item["clips"][0]["licence"] == "Pexels License"
        assert item["srt_path"].endswith("subtitles.srt") and Path(item["srt_path"]).read_text().startswith("1\n")
    assert [e for e in log if e[0] == "script"] == [("script", 1), ("script", 2)]
    assert {i["hook"] for i in repo.items.values()} == {"Hook 1", "Hook 2"}
    assert len(calls["burn"]) == 2 and calls["mix"][0][1]["duck"] is True
    # Every paid call metered once, in integer micro-dollars, per stage.
    rows = deps.charges.rows
    assert sorted(r["stage"] for r in rows.values()) == ["script", "script", "timing", "timing", "voice", "voice"]
    assert sum(r["cost_micros"] for r in rows.values()) == 2 * (10_000 + 2_000 + 1_000)
    assert len(entries) == 6


async def test_variants_get_different_footage(tmp_path, monkeypatch):
    from marketer.short_video import pipeline

    pool = [StockClip(provider="pexels", provider_id=f"{s}-{n}", segment=s) for s in range(3) for n in range(4)]
    a = pipeline.pick_footage(list(pool), need=5, seed=pipeline.seed_for(UUID(int=1), 1, 1))
    b = pipeline.pick_footage(list(pool), need=5, seed=pipeline.seed_for(UUID(int=1), 2, 1))
    assert [c.segment for c in a[:3]] == [0, 1, 2]  # every segment before a second pick
    assert [c.provider_id for c in a] != [c.provider_id for c in b]


async def test_batch_cap_stops_later_variants_but_keeps_finished_ones(tmp_path, monkeypatch):
    from marketer.config import settings
    from marketer.short_video import pipeline

    monkeypatch.setattr(settings, "assets_dir", str(tmp_path))
    # Each variant costs 13,000 micros; the script step estimates 50,000. With a
    # 70,000 cap two variants fit and the third is refused before it calls anything.
    repo = FakeRepo(_batch(variants=3, cap=70_000))
    deps, _, _ = _deps(repo, tmp_path)
    assert await pipeline.run_batch(user_id=USER, batch_id=repo.batch.id, deps=deps) == "partial"
    statuses = [repo.items[i.id]["status"] for i in repo.batch.items]
    assert statuses == ["done", "done", "failed"]
    failed = [repo.items[i.id] for i in repo.batch.items if repo.items[i.id]["status"] == "failed"]
    assert all("batch spend cap" in f["error"] for f in failed)
    assert sum(r["cost_micros"] for r in deps.charges.rows.values()) == 26_000


async def test_spend_cap_from_spend_context_fails_the_variant(tmp_path, monkeypatch):
    from marketer.config import settings
    from marketer.repos.spend import SpendCapExceeded
    from marketer.short_video import pipeline

    monkeypatch.setattr(settings, "assets_dir", str(tmp_path))
    repo = FakeRepo(_batch(variants=1))
    deps, _, _ = _deps(repo, tmp_path)

    async def capped(text, out, *, look, spend):
        raise SpendCapExceeded("user hit global daily cap", scope="global")

    deps.synthesize = capped
    assert await pipeline.run_batch(user_id=USER, batch_id=repo.batch.id, deps=deps) == "failed"
    item = next(iter(repo.items.values()))
    assert item["status"] == "failed" and "global daily cap" in item["error"]
    assert item["stages"]["voice"]["state"] == "failed"


async def test_rerun_reuses_paid_work_and_double_spawn_is_noop(tmp_path, monkeypatch):
    from marketer.config import settings
    from marketer.short_video import pipeline

    monkeypatch.setattr(settings, "assets_dir", str(tmp_path))
    repo = FakeRepo(_batch(variants=1))
    log: list = []
    deps, _, _ = _deps(repo, tmp_path, log=log)
    await pipeline.run_batch(user_id=USER, batch_id=repo.batch.id, deps=deps)
    # Same attempt again (e.g. the worker restarted after paying): nothing is bought twice.
    item_id = repo.batch.items[0].id
    repo.items[item_id].update(status="queued")
    repo.batch = repo.batch.model_copy(update={"status": "queued"})
    await pipeline.run_batch(user_id=USER, batch_id=repo.batch.id, deps=deps)
    assert [e for e in log if e[0] == "script"] == [("script", 1)]
    assert [e for e in log if e[0] == "voice"] == [("voice",)]
    assert repo.items[item_id]["status"] == "done"
    # A batch that's already done does nothing.
    assert await pipeline.run_batch(user_id=USER, batch_id=repo.batch.id, deps=deps) == "done"


async def test_pasted_script_makes_no_script_call_and_cancel_stops(tmp_path, monkeypatch):
    from marketer.config import settings
    from marketer.short_video import pipeline

    monkeypatch.setattr(settings, "assets_dir", str(tmp_path))
    s = ShortVideoSettings.model_validate({"subtitles": {"delivery": "sidecar"}, "music": {"mode": "none"}})
    repo = FakeRepo(_batch(variants=2, source="script", settings=s))
    log: list = []
    deps, calls, _ = _deps(repo, tmp_path, log=log)
    repo.cancelled.add(repo.batch.items[1].id)
    await pipeline.run_batch(user_id=USER, batch_id=repo.batch.id, deps=deps)
    assert not [e for e in log if e[0] == "script"]
    first, second = (repo.items[i.id] for i in repo.batch.items)
    assert first["status"] == "done" and second["status"] == "cancelled"
    assert first["search_terms"] and first["stages"]["music"]["state"] == "skipped"
    assert calls["burn"] == [] and calls["mix"][0][0] is None  # sidecar only, no music


# ------------------------------------------------------- routes + permissions

@pytest.fixture
def spawns(monkeypatch):
    calls: list = []

    class _Fn:
        def __init__(self, name):
            self.name = name

        def spawn(self, *a):
            calls.append((self.name, *a))

    monkeypatch.setitem(sys.modules, "modal",
                        types.SimpleNamespace(Function=types.SimpleNamespace(from_name=lambda app, name: _Fn(name))))
    return calls


@pytest.fixture
def fake_repo(monkeypatch, keys):
    from marketer.repos import short_videos as repo

    state: dict[UUID, ShortVideoBatch] = {}

    async def create_batch(**kw):
        b = _batch(variants=kw["variants"])
        b = b.model_copy(update={k: v for k, v in kw.items() if k in ("status", "estimate_micros", "cap_micros",
                                                                       "args_hash", "source", "topic", "script",
                                                                       "variants", "niche_id")}
                         | {"settings": ShortVideoSettings.model_validate(kw["settings"])})
        state[b.id] = b
        return b

    async def get_batch(batch_id, *, user_id):
        return state.get(batch_id)

    async def transition_batch(batch_id, *, user_id, from_status, to_status, **kw):
        b = state.get(batch_id)
        if b is None or b.status not in from_status:
            return False
        state[batch_id] = b.model_copy(update={"status": to_status})
        return True

    monkeypatch.setattr(repo, "create_batch", create_batch)
    monkeypatch.setattr(repo, "get_batch", get_batch)
    monkeypatch.setattr(repo, "transition_batch", transition_batch)
    return state


def _client(monkeypatch, role="owner", **kw) -> TestClient:
    from marketer.config import settings

    monkeypatch.setattr(settings, "auth_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import require_user
    from backend.main import create_app
    from backend.rate_limit import limiter

    limiter._storage.reset()
    app = create_app()
    ctx = ctx_for(role, user_id=USER, **kw)
    app.dependency_overrides[require_user] = lambda: ctx
    return TestClient(app, raise_server_exceptions=False)


def test_small_batch_starts_large_batch_waits(monkeypatch, rails_store, spawns, fake_repo):
    c = _client(monkeypatch)
    r = c.post("/api/v1/short-videos", json={"topic": "coffee myths"})
    assert r.status_code == 202, r.text
    assert r.json()["status"] == "queued"
    assert spawns == [("run_short_video", USER, r.json()["id"])]

    r = c.post("/api/v1/short-videos", json={"topic": "coffee myths", "variants": 5})
    assert r.status_code == 202 and r.json()["status"] == "awaiting_approval"
    assert len(spawns) == 1  # nothing spent until a person approves

    est = c.post("/api/v1/short-videos/estimate", json={"topic": "coffee myths", "variants": 5}).json()
    assert est["needs_approval"] is True and Decimal(est["total_usd"]) > 0


def test_approve_is_person_only_rails_checked_and_args_bound(monkeypatch, rails_store, spawns, fake_repo):
    owner = _client(monkeypatch)
    bid = owner.post("/api/v1/short-videos", json={"topic": "coffee myths", "variants": 5}).json()["id"]

    agent = _client(monkeypatch, "agent", actor_role="owner")
    r = agent.post(f"/api/v1/short-videos/{bid}/approve")
    assert r.status_code == 403

    rails_store.kill_switches.add("spend")
    r = owner.post(f"/api/v1/short-videos/{bid}/approve")
    assert r.status_code == 402 and r.json()["detail"].startswith("kill_switch")
    rails_store.kill_switches.clear()

    # The batch changed after it was requested: the approval no longer applies.
    b = fake_repo[UUID(bid)]
    fake_repo[UUID(bid)] = b.model_copy(update={"variants": 9})
    r = owner.post(f"/api/v1/short-videos/{bid}/approve")
    assert r.status_code == 409 and "approval_args_mismatch" in r.json()["detail"]
    fake_repo[UUID(bid)] = b

    r = owner.post(f"/api/v1/short-videos/{bid}/approve")
    assert r.status_code == 202, r.text
    assert spawns[-1] == ("run_short_video", USER, bid)
    assert owner.post(f"/api/v1/short-videos/{bid}/approve").status_code == 409  # single use


def test_permissions_on_short_video_routes(monkeypatch, rails_store, spawns, fake_repo):
    analyst = _client(monkeypatch, "analyst")
    assert analyst.post("/api/v1/short-videos", json={"topic": "coffee myths"}).status_code == 403
    assert analyst.post(f"/api/v1/short-videos/{uuid4()}/approve").status_code == 403


def test_upload_start_validates_and_needs_object_storage(monkeypatch, rails_store):
    c = _client(monkeypatch)
    r = c.post("/api/v1/short-videos/uploads", json={"filename": "a.exe", "content_type": "application/x-msdownload", "size_bytes": 10})
    assert r.status_code == 422
    r = c.post("/api/v1/short-videos/uploads", json={"filename": "a.mp4", "content_type": "video/mp4", "size_bytes": 10})
    assert r.status_code == 409  # object storage isn't configured in tests


def test_footage_search_hides_download_urls(monkeypatch, rails_store, keys):
    from marketer.repos import short_videos as repo

    async def fake_search(terms, **kw):
        return [StockClip(provider="pexels", provider_id="1", download_url="https://videos.pexels.com/a.mp4",
                          creator="Ana", licence="Pexels License", query=terms[0][1])]

    monkeypatch.setattr(stock, "search", fake_search)
    monkeypatch.setattr(repo, "PgSearchCache", lambda: None)
    r = _client(monkeypatch).get("/api/v1/short-videos/footage/search", params={"q": "Coffee pour!"})
    assert r.status_code == 200
    assert r.json()[0]["download_url"] == "" and r.json()[0]["query"] == "coffee pour"


def test_options_lists_configured_sources(monkeypatch, rails_store, keys):
    body = _client(monkeypatch).get("/api/v1/short-videos/options").json()
    assert body["footage_sources"] == ["pexels", "pixabay"]
    assert body["defaults"]["look"]["aspect"] == "9:16"
    assert json.dumps(body).find("pexels-key") == -1  # keys never leave the server


@pytest.mark.skipif(not __import__("shutil").which("ffmpeg"), reason="ffmpeg not installed")
def test_real_ffmpeg_render_end_to_end(tmp_path):
    """Slices (video + image, speed, fades, crop) → concat → mix with ducking →
    burned highlight subtitles, with real ffmpeg on generated inputs."""
    import subprocess

    def gen(args, name):
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *args, str(tmp_path / name)], check=True)
        return tmp_path / name

    a = gen(["-f", "lavfi", "-i", "testsrc=size=1280x720:rate=25", "-t", "4"], "a.mp4")
    p = gen(["-f", "lavfi", "-i", "color=c=blue:s=600x600", "-frames:v", "1"], "p.png")
    vo = gen(["-f", "lavfi", "-i", "sine=frequency=300:duration=4"], "vo.wav")
    m = gen(["-f", "lavfi", "-i", "sine=frequency=600:duration=2"], "m.mp3")
    srcs = [edit_plan.Source(str(a), 4, "video", 0), edit_plan.Source(str(p), 4, "image", 1)]
    slices = edit_plan.plan(srcs, audio_duration=4.4, clip_duration=2.0, speed=1.5, transition="fade", seed=1)
    parts = render.render_slices(slices, tmp_path / "s", aspect="9:16", fit="crop")
    silent = render.concat(parts, tmp_path / "silent.mp4", duration=4.4)
    words = [{"word": w, "start": i * 0.5, "end": i * 0.5 + 0.4} for i, w in enumerate("try this today".split())]
    cues = captions.build_cues(captions.align_to_script(words, "Try this today."))
    subs = captions.write_all(cues, SubtitleSettings(), tmp_path / "subs", width=1080, height=1920)
    mixed = render.mix(silent, vo, m, tmp_path / "mixed.mp4", duration=4.4, volume_db=-18, duck=True)
    final = render.burn(mixed, subs["ass"], tmp_path / "final.mp4")
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration",
                          "-of", "json", str(final)], check=True, capture_output=True, text=True).stdout
    info = json.loads(out)
    kinds = {s["codec_type"] for s in info["streams"]}
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    assert kinds == {"video", "audio"} and (video["width"], video["height"]) == (1080, 1920)
    assert abs(float(info["format"]["duration"]) - 4.4) < 0.3


async def test_spans_root_and_stages_reach_the_ai_exporter_without_search_terms(tmp_path, monkeypatch):
    from marketer.config import settings
    from marketer.short_video import pipeline
    from tests.otel_helpers import all_text, masked_memory

    monkeypatch.setattr(settings, "assets_dir", str(tmp_path))
    repo = FakeRepo(_batch(variants=1))
    deps, _, _ = _deps(repo, tmp_path)
    with masked_memory(ai_only=True) as exporter:
        await pipeline.run_batch(user_id=USER, batch_id=repo.batch.id, deps=deps)
        spans = exporter.get_finished_spans()
    names = [s.name for s in spans]
    assert "pipeline.short_video.run" in names
    assert {f"pipeline.short_video.stage.{s}" for s in pipeline.STAGES} <= set(names)
    root = next(s for s in spans if s.name == "pipeline.short_video.run")
    assert root.attributes["tenant_id"] == USER and root.attributes["agent"] == "short_video_pipeline"
    assert "coffee beans" not in all_text(spans)  # search terms stay off spans
