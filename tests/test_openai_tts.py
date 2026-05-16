from __future__ import annotations

import wave
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from autocontent.services import openai_tts


def _write_silence_wav(path: Path, seconds: float = 2.0, rate: int = 22050) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(rate * seconds))


class _FakeStreamingResponse:
    def __init__(self, target_seconds: float):
        self._target_seconds = target_seconds

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def stream_to_file(self, path):
        _write_silence_wav(Path(path), seconds=self._target_seconds)


@pytest.fixture
def fake_client(monkeypatch):
    client = MagicMock()
    client.audio.speech.with_streaming_response.create = MagicMock(
        return_value=_FakeStreamingResponse(target_seconds=60.0)
    )
    monkeypatch.setattr(openai_tts, "_client", client)
    return client


async def test_synthesize_writes_wav_and_logs_spend(tmp_path: Path, fake_client, fake_spend):
    ctx, rec = fake_spend
    out = tmp_path / "voiceover.wav"

    result = await openai_tts.synthesize(
        "hello world", out, voice="onyx",
        style_directions="calm and conspiratorial",
        spend=ctx,
    )

    assert result == out and out.exists()
    fake_client.audio.speech.with_streaming_response.create.assert_called_once()
    kwargs = fake_client.audio.speech.with_streaming_response.create.call_args.kwargs
    assert kwargs["model"] == "gpt-4o-mini-tts"
    assert kwargs["voice"] == "onyx"
    assert kwargs["instructions"] == "calm and conspiratorial"

    assert len(rec.entries) == 1
    # 60s of audio at $0.015/min == $0.015
    assert rec.entries[0].cost_usd == Decimal("0.0150")
