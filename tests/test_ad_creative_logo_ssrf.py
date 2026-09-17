"""Ad-creative logo fetch must not open a socket to a private host."""
from __future__ import annotations

from pathlib import Path

from marketer.adcreative import renderer


async def test_load_logo_returns_none_without_fetching_when_ssrf_blocks(
    monkeypatch, tmp_path: Path
) -> None:
    fetched: list[str] = []

    class _Client:
        def __init__(self, *a, **k): ...
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url):
            fetched.append(url)
            raise AssertionError("must not fetch a private logo URL")

    monkeypatch.setattr(renderer.httpx, "AsyncClient", _Client)
    monkeypatch.setattr(
        "marketer.services.ssrf.check_public_url",
        lambda url: (False, "resolves to a private address"),
    )
    dest = tmp_path / "logo.png"
    path = await renderer.load_logo("https://cdn.internal/logo.png", dest)
    assert path is None
    assert fetched == []
    assert not dest.exists()


async def test_load_logo_empty_url_is_a_noop(tmp_path: Path) -> None:
    assert await renderer.load_logo(None, tmp_path / "logo.png") is None
    assert await renderer.load_logo("", tmp_path / "logo.png") is None
