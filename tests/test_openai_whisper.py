from __future__ import annotations

import wave
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from autocontent.services import openai_whisper


def _write_silence_wav(path: Path, seconds: float = 60.0, rate: int = 16000) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(rate * seconds))


@pytest.fixture
def fake_client(monkeypatch):
    client = MagicMock()
    client.audio.transcriptions.create = AsyncMock(
        return_value=SimpleNamespace(
            words=[
                {"word": "hello", "start": 0.0, "end": 0.5},
                {"word": "world", "start": 0.5, "end": 1.0},
            ]
        )
    )
    monkeypatch.setattr(openai_whisper, "_client", client)
    return client


async def test_transcribe_returns_word_dicts_and_logs(tmp_path: Path, fake_client, fake_spend):
    ctx, rec = fake_spend
    audio = tmp_path / "vo.wav"
    _write_silence_wav(audio, seconds=60.0)

    words = await openai_whisper.transcribe_word_level(audio, spend=ctx)

    assert words == [
        {"word": "hello", "start": 0.0, "end": 0.5},
        {"word": "world", "start": 0.5, "end": 1.0},
    ]
    fake_client.audio.transcriptions.create.assert_awaited_once()
    kwargs = fake_client.audio.transcriptions.create.call_args.kwargs
    assert kwargs["model"] == "whisper-1"
    assert kwargs["response_format"] == "verbose_json"
    assert kwargs["timestamp_granularities"] == ["word"]

    assert len(rec.entries) == 1
    # 60s at $0.006/min == $0.006
    assert rec.entries[0].cost_usd == Decimal("0.0060")
