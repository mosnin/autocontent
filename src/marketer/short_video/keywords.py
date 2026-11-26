"""Script → segments → stock search terms.

The script writer returns its own terms per sentence (it knows what the
sentence is about). A pasted script gets terms from this deterministic
extractor instead, so no paid call is needed: drop stop words and filler,
prefer capitalised names and longer concrete words, keep at most two words per
term. Terms are lower-case, ASCII-safe and short, because stock search APIs
match on literal words.
"""
from __future__ import annotations

import re

_STOP = frozenset(
    """
    a about above after again against all almost also am an and any are as at be because been before being below
    between both but by can could did do does doing done down during each even ever every few for from further get
    gets getting go goes going gone got had has have having he her here hers herself him himself his how i if in into
    is it its itself just know like make makes many may me might more most much must my myself need never new no nor
    not now of off often on once one only or other our ours ourselves out over own really right same say says see
    she should so some still such take than that the their theirs them themselves then there these they thing things
    think this those though through to too under until up us use very want was way we well were what when where which
    while who whom why will with without would yet you your yours yourself yourselves actually literally simply maybe
    let lets here's that's it's don't doesn't can't won't you're we're they're i'm ive i've youll you'll
    today tomorrow yesterday time times day days year years week weeks first last next people someone something
    everyone everything nothing anything start stop try tried keep kept give gave put
    """.split()
)

_SENTENCE = re.compile(r"(?<=[.!?…])\s+|\n+")
_WORD = re.compile(r"[A-Za-z][A-Za-z'\-]*")


def split_segments(script: str) -> list[str]:
    """Sentences, merged so no segment is under four words (tiny segments make
    tiny clips)."""
    raw = [s.strip() for s in _SENTENCE.split(script.strip()) if s and s.strip()]
    out: list[str] = []
    for s in raw:
        if out and len(out[-1].split()) < 4:
            out[-1] = f"{out[-1]} {s}"
        else:
            out.append(s)
    return out


def _candidates(sentence: str) -> list[tuple[float, int, str]]:
    found: list[tuple[float, int, str]] = []
    words = _WORD.findall(sentence)
    for i, w in enumerate(words):
        lw = w.lower().strip("'-")
        if len(lw) < 3 or lw in _STOP:
            continue
        score = min(len(lw), 10) / 10
        if w[0].isupper() and i > 0:
            score += 0.6  # a name mid-sentence
        if lw.endswith(("ing", "ly")):
            score -= 0.3  # verbs and adverbs film badly
        found.append((score, i, lw))
    return found


def terms_for(sentence: str, *, max_terms: int = 2) -> list[str]:
    """One or two search terms for a sentence: the best single word, and the
    best adjacent pair when there is one."""
    cands = _candidates(sentence)
    if not cands:
        return []
    by_pos = {i: (s, w) for s, i, w in cands}
    pairs: list[tuple[float, str]] = []
    for i, (s, w) in by_pos.items():
        nxt = by_pos.get(i + 1)
        if nxt is not None:
            pairs.append((s + nxt[0], f"{w} {nxt[1]}"))
    singles = sorted(cands, key=lambda c: (-c[0], c[1]))
    terms: list[str] = []
    if pairs:
        terms.append(max(pairs, key=lambda p: p[0])[1])
    for _, _, w in singles:
        if len(terms) >= max_terms:
            break
        if all(w not in t.split() for t in terms):
            terms.append(w)
    return terms[:max_terms]


def clean_term(term: str) -> str:
    """What a model or person sends, made safe for a search query."""
    words = [w.lower() for w in _WORD.findall(term)][:3]
    return " ".join(words)[:40]


def search_terms(script: str, *, topic: str = "", limit: int = 12) -> list[tuple[int, str]]:
    """(segment index, term) pairs in script order, deduplicated. The topic is
    a fallback for segments that yield nothing."""
    seen: set[str] = set()
    out: list[tuple[int, str]] = []
    fallback = terms_for(topic, max_terms=1) if topic else []
    for idx, seg in enumerate(split_segments(script)):
        terms = terms_for(seg) or fallback
        for t in terms:
            if t and t not in seen:
                seen.add(t)
                out.append((idx, t))
                break  # one per segment first; extra terms below
    if len(out) < limit:
        for idx, seg in enumerate(split_segments(script)):
            for t in terms_for(seg)[1:]:
                if t not in seen and len(out) < limit:
                    seen.add(t)
                    out.append((idx, t))
    return out[:limit]
