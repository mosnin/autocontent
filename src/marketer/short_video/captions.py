"""Subtitles from word timings: script-true words, lines, SRT, VTT and ASS.

Timing comes from Whisper's word timestamps on our own voiceover (the most
accurate source we have: it measures the audio that will play). Whisper's
SPELLING is not trusted: names, numbers and punctuation are taken from the
script wherever the two align (difflib over normalised tokens). The idea of
correcting transcribed subtitles against the script comes from
MoneyPrinterTurbo's ``app/services/subtitle.py`` (``correct``; MIT,
Copyright (c) 2024 Harry); this implementation is new.

Cues break on sentence punctuation, on a pause, on ``max_chars`` and on a
three-second ceiling, so lines stay readable on a phone.
"""
from __future__ import annotations

import difflib
import re
from dataclasses import dataclass
from pathlib import Path

from .models import SubtitleSettings

PAUSE_BREAK_SEC = 0.6
MAX_CUE_SEC = 3.0
_TOKEN = re.compile(r"\S+")
_NORM = re.compile(r"[^a-z0-9]")


@dataclass(frozen=True)
class Word:
    text: str
    start: float
    end: float


@dataclass(frozen=True)
class Cue:
    start: float
    end: float
    words: tuple[Word, ...]

    @property
    def text(self) -> str:
        return " ".join(w.text for w in self.words)


def _norm(s: str) -> str:
    return _NORM.sub("", s.lower())


def align_to_script(words: list[dict], script: str) -> list[Word]:
    """Whisper words with the script's spelling where tokens line up. Unmatched
    whisper words keep their own text; script words Whisper missed are dropped
    (they have no timing)."""
    heard = [Word(str(w["word"]).strip(), float(w["start"]), float(w["end"])) for w in words if str(w["word"]).strip()]
    script_tokens = _TOKEN.findall(script)
    if not heard or not script_tokens:
        return heard
    a = [_norm(w.text) for w in heard]
    b = [_norm(t) for t in script_tokens]
    out = list(heard)
    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal" or (tag == "replace" and (i2 - i1) == (j2 - j1)):
            for k in range(i2 - i1):
                w = heard[i1 + k]
                out[i1 + k] = Word(script_tokens[j1 + k], w.start, w.end)
    return out


def build_cues(words: list[Word], *, max_chars: int = 22) -> list[Cue]:
    cues: list[Cue] = []
    cur: list[Word] = []
    for w in words:
        if cur:
            text_len = len(" ".join(x.text for x in cur)) + 1 + len(w.text)
            gap = w.start - cur[-1].end
            too_long = text_len > max_chars or (w.end - cur[0].start) > MAX_CUE_SEC
            if too_long or gap >= PAUSE_BREAK_SEC:
                cues.append(Cue(cur[0].start, cur[-1].end, tuple(cur)))
                cur = []
        cur.append(w)
        if w.text.endswith((".", "!", "?", "…")):
            cues.append(Cue(cur[0].start, cur[-1].end, tuple(cur)))
            cur = []
    if cur:
        cues.append(Cue(cur[0].start, cur[-1].end, tuple(cur)))
    # Close tiny gaps so lines don't flicker between words.
    fixed: list[Cue] = []
    for i, c in enumerate(cues):
        end = c.end
        if i + 1 < len(cues) and 0 < cues[i + 1].start - end < 0.25:
            end = cues[i + 1].start
        fixed.append(Cue(c.start, end, c.words))
    return fixed


def _ts(seconds: float, sep: str) -> str:
    ms = max(0, int(round(seconds * 1000)))
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def to_srt(cues: list[Cue]) -> str:
    blocks = [f"{i}\n{_ts(c.start, ',')} --> {_ts(c.end, ',')}\n{c.text}\n" for i, c in enumerate(cues, 1)]
    return "\n".join(blocks)


def to_vtt(cues: list[Cue]) -> str:
    body = "\n".join(f"{_ts(c.start, '.')} --> {_ts(c.end, '.')}\n{c.text}\n" for c in cues)
    return "WEBVTT\n\n" + body


# --------------------------------------------------------------------- ASS

_POS = {"bottom": (2, 0.22), "center": (5, 0.0), "top": (8, 0.08)}


def _ass_time(seconds: float) -> str:
    cs = max(0, int(round(seconds * 100)))
    h, rem = divmod(cs, 360_000)
    m, rem = divmod(rem, 6000)
    s, cs = divmod(rem, 100)
    return f"{h:d}:{m:02d}:{s:02d}.{cs:02d}"


def _bgr(hex_rgb: str) -> str:
    h = hex_rgb.strip().lstrip("#").upper()
    return f"&H00{h[4:6]}{h[2:4]}{h[0:2]}"


def _esc(text: str) -> str:
    return text.replace("\\", "").replace("{", "(").replace("}", ")").replace("\n", " ")


def ass_header(style: SubtitleSettings, *, width: int, height: int) -> str:
    align, frac = _POS[style.position]
    margin_v = int(height * frac)
    primary, outline = _bgr(style.text_hex), _bgr(style.outline_hex)
    shadow = 2 if style.outline_px else 0
    return (
        "[Script Info]\nScriptType: v4.00+\n"
        f"PlayResX: {width}\nPlayResY: {height}\nScaledBorderAndShadow: yes\nWrapStyle: 0\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
        "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
        "MarginR, MarginV, Encoding\n"
        f"Style: Default,{style.font},{style.font_size},{primary},{primary},{outline},&H80000000,-1,0,0,0,100,100,0,0,1,"
        f"{style.outline_px},{shadow},{align},80,80,{margin_v},1\n\n"
        "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )


def to_ass(cues: list[Cue], style: SubtitleSettings, *, width: int, height: int) -> str:
    up = (lambda s: s.upper()) if style.uppercase else (lambda s: s)
    lines = [ass_header(style, width=width, height=height)]

    def event(start: float, end: float, text: str) -> None:
        if end > start:
            lines.append(f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},Default,,0,0,0,,{text}\n")

    hl = _bgr(style.highlight_hex)
    for c in cues:
        if style.mode == "sentence":
            event(c.start, c.end, up(_esc(c.text)))
        elif style.mode == "word":
            for w in c.words:
                event(w.start, w.end, up(_esc(w.text)))
        else:  # highlight: the whole line, the spoken word in the highlight colour
            for i, w in enumerate(c.words):
                end = c.words[i + 1].start if i + 1 < len(c.words) else c.end
                parts = [
                    (f"{{\\c{hl}}}{up(_esc(x.text))}{{\\r}}" if j == i else up(_esc(x.text)))
                    for j, x in enumerate(c.words)
                ]
                event(w.start, end, " ".join(parts))
    return "".join(lines)


def write_all(cues: list[Cue], style: SubtitleSettings, outdir: Path, *, width: int, height: int) -> dict[str, Path]:
    outdir.mkdir(parents=True, exist_ok=True)
    paths = {"srt": outdir / "subtitles.srt", "vtt": outdir / "subtitles.vtt", "ass": outdir / "subtitles.ass"}
    paths["srt"].write_text(to_srt(cues), encoding="utf-8")
    paths["vtt"].write_text(to_vtt(cues), encoding="utf-8")
    paths["ass"].write_text(to_ass(cues, style, width=width, height=height), encoding="utf-8")
    return paths
