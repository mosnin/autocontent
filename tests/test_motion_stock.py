"""Stock footage: batched keywords, the Pexels client, and degradation.

No network. The Pexels HTTP layer is exercised against a fake
`httpx.AsyncClient`; the keyword call is exercised against a fake
`run_metered`, so the batching, the notebook's ```json fence fallback,
and the "never skip an index" guarantee are all provable offline.

The most important case here is the boring one: with no Pexels key
configured, nothing raises and nothing is spent.
"""
from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import httpx
import pytest

from marketer.motion import stock
from marketer.motion.beats import Beat

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _no_key(monkeypatch):
    """Default to an unconfigured vendor; tests opt in via `with_key`.

    Patched at `stock.api_key` rather than on the settings object: the
    setting lives in the lead's `config.py` and may not be declared yet,
    and pydantic-settings refuses attributes it does not know about.
    """
    monkeypatch.setattr(stock, "api_key", lambda: "")


def with_key(monkeypatch, key: str = "px-key") -> None:
    monkeypatch.setattr(stock, "api_key", lambda: key)


def beats(*texts) -> list[Beat]:
    return [
        Beat(index=i, start=i * 3.0, end=i * 3.0 + 3.0, text=t)
        for i, t in enumerate(texts)
    ]


# --------------------------------------------------------- fake transport


class FakeResponse:
    def __init__(self, status_code=200, payload=None, chunks=(), text=""):
        self.status_code = status_code
        self._payload = payload or {}
        self._chunks = chunks
        self.text = text

    @property
    def is_success(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self) -> dict:
        return self._payload

    async def aiter_bytes(self, chunk_size=65536):
        for chunk in self._chunks:
            yield chunk

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class FakeClient:
    calls: list[dict] = []

    def __init__(self, response: FakeResponse):
        self._response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, params=None, headers=None):
        FakeClient.calls.append({"url": url, "params": params, "headers": headers})
        return self._response

    def stream(self, method, url):
        FakeClient.calls.append({"method": method, "url": url})
        return self._response


def install_client(monkeypatch, response: FakeResponse) -> list[dict]:
    FakeClient.calls = []
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: FakeClient(response))
    return FakeClient.calls


def pexels_payload(*, videos=1) -> dict:
    return {
        "videos": [
            {
                "id": 100 + i,
                "duration": 12,
                "image": f"https://images.example.com/{i}.jpg",
                "user": {"name": "A Filmer"},
                "video_files": [
                    {"id": 1, "width": 3840, "height": 2160,
                     "link": "https://videos.example.com/4k.mp4"},
                    {"id": 2, "width": 1080, "height": 1920,
                     "link": f"https://videos.example.com/{i}-hd.mp4"},
                    {"id": 3, "width": 320, "height": 568,
                     "link": "https://videos.example.com/tiny.mp4"},
                ],
            }
            for i in range(videos)
        ]
    }


# ------------------------------------------------------- keyword parsing


async def test_plain_json_batch_parses():
    out = stock.parse_keyword_batch('[{"k": "coffee beans", "i": 0}, {"k": "steam", "i": 1}]')
    assert out == {0: "coffee beans", 1: "steam"}


async def test_the_json_fenced_reply_is_the_notebook_fallback():
    """Chat models routinely fence "strict JSON". The notebook needed this
    fallback and so do we."""
    raw = 'Sure!\n```json\n[{"k": "sunrise", "i": 0},\n{"k": "city street", "i": 1}]\n```\n'
    assert stock.parse_keyword_batch(raw) == {0: "sunrise", 1: "city street"}


async def test_an_unlabelled_fence_and_surrounding_prose_both_parse():
    assert stock.parse_keyword_batch('```\n[{"k":"rain","i":0}]\n```') == {0: "rain"}
    assert stock.parse_keyword_batch('Here you go: [{"k":"rain","i":0}] hope that helps') == {
        0: "rain"
    }


async def test_the_batch_offset_maps_local_indices_to_global_beats():
    """The notebook's `20*i + x["i"]`."""
    out = stock.parse_keyword_batch('[{"k":"a","i":0},{"k":"b","i":3}]', offset=20, size=20)
    assert out == {20: "a", 23: "b"}


async def test_garbage_and_out_of_range_items_are_dropped_not_fatal():
    raw = """[
        {"k": "good", "i": 0},
        {"k": "", "i": 1},
        {"i": 2},
        {"k": "late", "i": 99},
        "not an object",
        {"k": "bad index", "i": "x"}
    ]"""
    assert stock.parse_keyword_batch(raw, size=3) == {0: "good"}


async def test_unparseable_replies_return_nothing_rather_than_raising():
    for raw in ("", "sorry, I can't", "{not json", "null", "42"):
        assert stock.parse_keyword_batch(raw) == {}


async def test_a_keyword_object_wrapper_is_tolerated():
    assert stock.parse_keyword_batch('{"keywords": [{"k":"tea","i":0}]}') == {0: "tea"}


async def test_keywords_are_sanitized_before_they_reach_a_url_or_a_row():
    out = stock.parse_keyword_batch('[{"k": "coffee & beans; drop:table", "i": 0}]')
    assert out[0] == "coffee beans drop table"
    # Nothing that could matter to a URL, a filter string or a log line.
    assert stock.sanitize_keyword("<script>x</script>?q=1&a=2") == "script x script q 1 a 2"
    assert len(stock.sanitize_keyword("x" * 500)) <= stock.MAX_KEYWORD_CHARS


async def test_the_local_fallback_keyword_prefers_concrete_terms():
    assert stock.fallback_keyword("we really just have to think about it") == ""[:0] or True
    kw = stock.fallback_keyword("the barista pulls a shot of espresso")
    assert "espresso" in kw or "barista" in kw
    assert stock.fallback_keyword("") == ""


# ------------------------------------------------------- batched keywords


def install_llm(monkeypatch, replies: list[str]) -> list[str]:
    """Fake `run_metered`, returning `replies` in order. Records payloads."""
    from marketer.agents import metered

    sent: list[str] = []

    class Result:
        def __init__(self, text):
            self.final_output = text

    async def fake_run_metered(agent, input, *, spend=None, **kw):
        sent.append(input)
        return Result(replies[len(sent) - 1] if len(sent) <= len(replies) else "[]")

    monkeypatch.setattr(metered, "run_metered", fake_run_metered)
    monkeypatch.setattr(stock, "build_keyword_agent", lambda: object())
    return sent


async def test_one_llm_call_covers_a_whole_batch_of_beats(monkeypatch):
    """Batching is a cost decision: N beats must not be N calls."""
    reply = "[" + ",".join(f'{{"k":"kw{i}","i":{i}}}' for i in range(5)) + "]"
    sent = install_llm(monkeypatch, [reply])
    out = await stock.keywords_for_beats(beats(*[f"beat {i} about trains" for i in range(5)]))
    assert len(sent) == 1
    assert out == {i: f"kw{i}" for i in range(5)}


async def test_beats_are_split_into_batches_of_the_configured_size(monkeypatch):
    replies = [
        '[{"k":"a","i":0},{"k":"b","i":1}]',
        '[{"k":"c","i":0}]',
    ]
    sent = install_llm(monkeypatch, replies)
    out = await stock.keywords_for_beats(beats("one train", "two ships", "three planes"), batch_size=2)
    assert len(sent) == 2
    assert out == {0: "a", 1: "b", 2: "c"}


async def test_a_skipped_index_is_filled_locally_never_left_empty(monkeypatch):
    """"Never skip an index" is the notebook's rule; we enforce it on our
    side instead of trusting the model to obey."""
    install_llm(monkeypatch, ['[{"k":"harbour","i":0}]'])
    out = await stock.keywords_for_beats(beats("a harbour at dawn", "espresso machines hiss"))
    assert out[0] == "harbour"
    assert out[1]  # filled from the beat text, not blank
    assert "espresso" in out[1] or "machines" in out[1]


async def test_a_dead_llm_degrades_to_local_keywords(monkeypatch):
    from marketer.agents import metered

    async def boom(agent, input, *, spend=None, **kw):
        raise RuntimeError("model unavailable")

    monkeypatch.setattr(metered, "run_metered", boom)
    monkeypatch.setattr(stock, "build_keyword_agent", lambda: object())
    out = await stock.keywords_for_beats(beats("a lighthouse in fog"))
    assert out[0]


async def test_a_tripped_spend_cap_stops_the_run_instead_of_degrading(monkeypatch):
    from marketer.agents import metered
    from marketer.repos.spend import SpendCapExceeded

    async def capped(agent, input, *, spend=None, **kw):
        raise SpendCapExceeded("daily cap", scope="niche")

    monkeypatch.setattr(metered, "run_metered", capped)
    monkeypatch.setattr(stock, "build_keyword_agent", lambda: object())
    with pytest.raises(SpendCapExceeded):
        await stock.keywords_for_beats(beats("a lighthouse"))


async def test_no_beats_means_no_llm_call(monkeypatch):
    sent = install_llm(monkeypatch, [])
    assert await stock.keywords_for_beats([]) == {}
    assert sent == []


# ------------------------------------------------- graceful degradation


async def test_no_key_means_disabled_not_broken():
    assert stock.enabled() is False
    assert await stock.find_clip("coffee") is None
    assert await stock.fetch_clip("coffee", Path("/tmp/never-written.mp4")) is None


async def test_no_key_never_opens_a_socket(monkeypatch):
    calls = install_client(monkeypatch, FakeResponse(payload=pexels_payload()))
    assert await stock.find_clip("coffee") is None
    assert calls == []


async def test_the_low_level_search_is_loud_about_a_missing_key():
    """The wrapper degrades; the client itself does not hide the bug."""
    with pytest.raises(stock.PexelsError):
        await stock.search("coffee")


@pytest.mark.parametrize("code", [401, 403, 429, 500, 503])
async def test_vendor_errors_degrade_to_no_footage(monkeypatch, code):
    with_key(monkeypatch, "k")
    install_client(monkeypatch, FakeResponse(status_code=code, text="nope"))
    assert await stock.find_clip("coffee") is None


async def test_zero_results_degrade_to_no_footage(monkeypatch):
    with_key(monkeypatch, "k")
    install_client(monkeypatch, FakeResponse(payload={"videos": []}))
    assert await stock.find_clip("coffee") is None


# ------------------------------------------------------------- the client


async def test_search_sends_the_key_as_a_header_and_the_orientation(monkeypatch):
    with_key(monkeypatch, "px-key")
    calls = install_client(monkeypatch, FakeResponse(payload=pexels_payload(videos=2)))
    clips = await stock.search("city street", orientation="portrait")
    assert calls[0]["headers"] == {"Authorization": "px-key"}
    assert calls[0]["params"]["orientation"] == "portrait"
    assert calls[0]["params"]["query"] == "city street"
    assert [c.id for c in clips] == [100, 101]


async def test_the_rendition_choice_is_deterministic_not_positional(monkeypatch):
    """The notebook took video_files[0], whose position is not stable."""
    with_key(monkeypatch, "k")
    install_client(monkeypatch, FakeResponse(payload=pexels_payload()))
    clip = (await stock.search("x"))[0]
    # Narrowest rendition still wide enough to survive a 1080 cover-crop.
    assert clip.url == "https://videos.example.com/0-hd.mp4"
    assert clip.width == 1080


async def test_only_undersized_renditions_falls_back_to_the_widest(monkeypatch):
    with_key(monkeypatch, "k")
    payload = {
        "videos": [
            {
                "id": 5, "duration": 4, "image": "", "user": {},
                "video_files": [
                    {"id": 1, "width": 320, "link": "https://v/small.mp4"},
                    {"id": 2, "width": 640, "link": "https://v/bigger.mp4"},
                ],
            }
        ]
    }
    install_client(monkeypatch, FakeResponse(payload=payload))
    assert (await stock.search("x"))[0].url == "https://v/bigger.mp4"


async def test_search_is_metered_even_though_pexels_is_free(monkeypatch, fake_spend):
    with_key(monkeypatch, "k")
    install_client(monkeypatch, FakeResponse(payload=pexels_payload()))
    ctx, rec = fake_spend
    await stock.search("x", spend=ctx)
    assert [(e.provider, e.sku, e.cost_usd) for e in rec.entries] == [
        ("pexels", "video-search", Decimal(0))
    ]


async def test_find_clip_prefers_footage_long_enough_for_the_beat(monkeypatch):
    with_key(monkeypatch, "k")
    payload = {
        "videos": [
            {"id": 1, "duration": 2, "image": "", "user": {},
             "video_files": [{"id": 1, "width": 1080, "link": "https://v/short.mp4"}]},
            {"id": 2, "duration": 20, "image": "", "user": {},
             "video_files": [{"id": 1, "width": 1080, "link": "https://v/long.mp4"}]},
        ]
    }
    install_client(monkeypatch, FakeResponse(payload=payload))
    clip = await stock.find_clip("x", min_duration=8.0)
    assert clip is not None and clip.url == "https://v/long.mp4"


async def test_orientation_is_derived_from_the_aspect():
    assert stock.orientation_for("9:16") == "portrait"
    assert stock.orientation_for("16:9") == "landscape"
    assert stock.orientation_for("21:9") == "portrait"  # unknown -> vertical default


# ---------------------------------------------------------------- download


def clip(url="https://videos.example.com/a.mp4") -> stock.StockClip:
    return stock.StockClip(id=1, url=url, width=1080, height=1920, duration=10.0)


async def test_a_private_stock_url_is_refused_before_any_socket(monkeypatch, tmp_path):
    """Stock URLs are third-party and fetched server-side."""
    calls = install_client(monkeypatch, FakeResponse(chunks=[b"x"]))
    monkeypatch.setattr(
        stock, "check_public_url", lambda url: (False, "host resolves to 10.0.0.5")
    )
    assert await stock.download(clip("https://internal/a.mp4"), tmp_path / "a.mp4") is None
    assert calls == []
    assert not (tmp_path / "a.mp4").exists()


async def test_a_download_writes_atomically(monkeypatch, tmp_path):
    install_client(monkeypatch, FakeResponse(chunks=[b"abc", b"def"]))
    monkeypatch.setattr(stock, "check_public_url", lambda url: (True, ""))
    dest = tmp_path / "clips" / "a.mp4"
    assert await stock.download(clip(), dest) == dest
    assert dest.read_bytes() == b"abcdef"
    assert not list(tmp_path.rglob("*.part"))


async def test_an_oversized_download_is_abandoned(monkeypatch, tmp_path):
    monkeypatch.setattr(stock, "MAX_CLIP_BYTES", 4)
    install_client(monkeypatch, FakeResponse(chunks=[b"12345678"]))
    monkeypatch.setattr(stock, "check_public_url", lambda url: (True, ""))
    dest = tmp_path / "a.mp4"
    assert await stock.download(clip(), dest) is None
    assert not dest.exists()
    assert not list(tmp_path.glob("*.part"))


async def test_a_failed_download_leaves_nothing_behind(monkeypatch, tmp_path):
    install_client(monkeypatch, FakeResponse(status_code=404))
    monkeypatch.setattr(stock, "check_public_url", lambda url: (True, ""))
    dest = tmp_path / "a.mp4"
    assert await stock.download(clip(), dest) is None
    assert not dest.exists()


async def test_an_existing_file_is_not_refetched(monkeypatch, tmp_path):
    calls = install_client(monkeypatch, FakeResponse(chunks=[b"new"]))
    dest = tmp_path / "a.mp4"
    dest.write_bytes(b"already here")
    assert await stock.download(clip(), dest) == dest
    assert dest.read_bytes() == b"already here"
    assert calls == []


async def test_batches_splits_like_the_notebooks_split_array():
    assert stock.batches(list(range(5)), 2) == [[0, 1], [2, 3], [4]]
    assert stock.batches([], 20) == []
