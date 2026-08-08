"""The video format catalog: invariants, prompt assembly, and guards.

Pure data + pure functions, so no fixtures, no DB, no network. The most
valuable test here is `test_every_format_admits_a_passing_script`: a
format whose own grader can never pass is a format that burns a full
render every time someone picks it.
"""
from __future__ import annotations

import re

import pytest

from marketer.evals.script_checks import HOOK_MAX_WORDS
from marketer.formats import registry
from marketer.formats.beats import (
    BeatContract,
    BeatRole,
    BeatSpec,
    Pacing,
    VoiceDirection,
    assign_roles,
)
from marketer.models import Idea, Scene, Script

ALL_FORMATS = registry.FORMATS
FORMAT_IDS = [f.key for f in ALL_FORMATS]


# ---------------------------------------------------------------- builders


def _narration(words: int, *, question: bool, loop: bool) -> str:
    """`words` words in one sentence, optionally opening a loop."""
    tokens = ["why"] if loop else ["this"]
    tokens += ["signal"] * max(0, words - 1)
    return " ".join(tokens[:words]) + ("?" if question else ".")


def make_script(fmt: registry.VideoFormat, beat_count: int | None = None) -> Script:
    """A script that satisfies `fmt` exactly, at a legal beat count."""
    n = beat_count or fmt.suggested_scene_count
    roles = assign_roles(n, fmt.contract)
    by_role = {s.role: s for s in fmt.contract.specs}
    p = fmt.pacing
    scenes: list[Scene] = []
    for i, role in enumerate(roles):
        spec = by_role[role]
        cap = p.beat_max_sec if spec.max_duration_sec is None else spec.max_duration_sec
        duration = max(p.beat_min_sec, min(cap, p.beat_max_sec))
        mid = (p.words_per_sec_min + p.words_per_sec_max) / 2 * duration
        scenes.append(
            Scene(
                index=i,
                narration=_narration(
                    int(mid),
                    question=spec.requires_question,
                    loop=spec.requires_open_loop or spec.requires_question,
                ),
                visual_prompt="clay diorama style, a small object on a table",
                motion_prompt="slow push in",
                duration_sec=duration,
            )
        )
    return Script(
        idea=Idea(
            topic="topic",
            angle="angle",
            hook="why this quietly happens every day",
            target_audience="audience",
            why_it_works="curiosity gap",
        ),
        scenes=scenes,
        total_duration_sec=sum(s.duration_sec for s in scenes),
    )


# ------------------------------------------------------------------- shape


def test_keys_are_unique_and_slugged():
    keys = [f.key for f in ALL_FORMATS]
    assert len(keys) == len(set(keys))
    for key in keys:
        assert re.fullmatch(r"[a-z0-9_]+", key), key


@pytest.mark.parametrize("fmt", ALL_FORMATS, ids=FORMAT_IDS)
def test_every_format_is_pickable(fmt):
    """The catalog row has to be enough to choose with."""
    assert fmt.label.strip()
    assert fmt.description.strip()
    assert fmt.best_for, f"{fmt.key} gives the picker no reason to choose it"
    assert fmt.instructions.strip(), f"{fmt.key} has no scriptwriter prompt"


@pytest.mark.parametrize("fmt", ALL_FORMATS, ids=FORMAT_IDS)
def test_every_beat_states_an_action(fmt):
    """`purpose` goes verbatim into the writer's prompt, so it must be an
    instruction, not a noun phrase."""
    for spec in fmt.contract.specs:
        assert spec.label.strip()
        assert len(spec.purpose.split()) >= 8, (fmt.key, spec.label)


def test_default_format_is_the_explainer():
    assert registry.DEFAULT_FORMAT_KEY == "explainer"
    assert registry.get_format(registry.DEFAULT_FORMAT_KEY) is not None


# -------------------------------------------------------------- resolution


def test_resolve_defaults_on_empty_key():
    assert registry.resolve(None).key == registry.DEFAULT_FORMAT_KEY
    assert registry.resolve("").key == registry.DEFAULT_FORMAT_KEY


def test_resolve_raises_on_unknown_key():
    """Never silently default: a typo would render the wrong video at
    full price and look like it worked."""
    with pytest.raises(registry.UnknownFormatKey) as exc:
        registry.resolve("documentry")
    assert "documentry" in str(exc.value)


def test_get_format_returns_none_for_unknown():
    assert registry.get_format("nope") is None


# ------------------------------------------------------------- the contract


@pytest.mark.parametrize("fmt", ALL_FORMATS, ids=FORMAT_IDS)
def test_every_format_admits_a_passing_script(fmt):
    """At every legal beat count, some script passes this format's own
    grader. If not, the format is unwritable and every pick of it wastes
    a render."""
    for n in range(fmt.contract.min_beats, fmt.contract.max_beats + 1):
        result = registry.check(make_script(fmt, n), fmt)
        assert result["passed"], (fmt.key, n, result["issues"])


@pytest.mark.parametrize("fmt", ALL_FORMATS, ids=FORMAT_IDS)
def test_beat_roles_are_unique_within_a_contract(fmt):
    """`beats.check_script` indexes specs by role, so a repeated role
    would silently drop one slot's rules."""
    roles = [s.role for s in fmt.contract.specs]
    assert len(roles) == len(set(roles))


@pytest.mark.parametrize("fmt", ALL_FORMATS, ids=FORMAT_IDS)
def test_every_format_closes_its_loop(fmt):
    assert fmt.contract.specs[-1].role in (BeatRole.button, BeatRole.reveal, BeatRole.cta)


@pytest.mark.parametrize("fmt", ALL_FORMATS, ids=FORMAT_IDS)
def test_hook_fits_the_three_second_audition(fmt):
    """Every format opens on a hook, and the hook is the shortest legal
    beat — the word budget is what actually enforces the 3 seconds."""
    hook = fmt.contract.specs[0]
    assert hook.role is BeatRole.hook
    assert hook.requires_open_loop
    assert hook.max_duration_sec == fmt.pacing.beat_min_sec
    # The hook must be writable inside HOOK_MAX_WORDS at this format's
    # own narration rate, or check_script fails it no matter what.
    min_words = fmt.pacing.words_per_sec_min * hook.max_duration_sec
    assert min_words <= HOOK_MAX_WORDS, (fmt.key, min_words)


@pytest.mark.parametrize("fmt", ALL_FORMATS, ids=FORMAT_IDS)
def test_voice_rate_matches_the_pacing_envelope(fmt):
    """Voice and cadence are one decision; disagreeing tempos render
    long or short."""
    wps = fmt.voice.words_per_minute / 60.0
    assert fmt.pacing.words_per_sec_min <= wps <= fmt.pacing.words_per_sec_max


def test_testimonial_fits_the_lip_sync_audio_cap():
    """Lip-sync models cap input audio near 30s (~75 words) and reject
    the render AFTER the keyframe and voiceover are paid for — see the
    `avatar.audio-length-cap` gotcha."""
    fmt = registry.get_format("ugc_testimonial")
    assert fmt.target_duration_sec <= 30
    max_words = fmt.target_duration_sec * fmt.pacing.words_per_sec_max
    assert max_words <= 75


def test_myth_buster_is_fixed_length():
    """No flexible slot: the verdict has to land inside ~35 seconds."""
    fmt = registry.get_format("myth_buster")
    assert fmt.contract.min_beats == fmt.contract.max_beats == 5
    assert all(s.max_count is not None for s in fmt.contract.specs)


def test_listicle_flexes_on_items_only():
    fmt = registry.get_format("listicle")
    flexible = [s for s in fmt.contract.specs if s.max_count is None]
    assert [s.role for s in flexible] == [BeatRole.item]


# -------------------------------------------------------- prompt assembly


def test_directives_carry_the_contract_the_writer_is_graded_on():
    fmt = registry.get_format("explainer")
    text = registry.scriptwriter_directives(fmt)
    for spec in fmt.contract.specs:
        assert spec.label in text
        assert spec.purpose[:30] in text
    assert "must contain a literal question mark" in text
    assert "must leave a question open" in text
    assert str(fmt.target_duration_sec) in text
    assert fmt.voice.persona in text
    assert str(fmt.voice.words_per_minute) in text


def test_directives_include_narration_gotchas_once():
    """Narration rules come from the gotchas KB, not a second copy —
    a rule stated twice in one prompt gets averaged, not followed."""
    text = registry.scriptwriter_directives(registry.get_format("explainer"))
    assert "MODEL CONSTRAINTS" in text
    assert text.count("MODEL CONSTRAINTS") == 1


def test_directives_render_counts_for_flexible_slots():
    text = registry.scriptwriter_directives(registry.get_format("listicle"))
    assert "3 or more" in text
    assert "exactly 1" in text


# ------------------------------------------------------------- wire shapes


def test_summaries_cover_the_catalog():
    rows = registry.summaries()
    assert [r.key for r in rows] == list(registry.FORMAT_KEYS)
    for row in rows:
        assert "->" in row.structure
        assert row.best_for
        assert row.min_beats <= row.suggested_scene_count <= row.max_beats


def test_detail_carries_beats_and_voice_direction():
    detail = registry.detail(registry.get_format("explainer"))
    assert detail.key == "explainer"
    assert detail.beats.structure == detail.structure
    assert len(detail.beats.beats) == len(detail.contract.specs)
    assert detail.voice.persona
    assert detail.pacing.shots_per_beat == 2
    assert "BEAT CONTRACT" in detail.scriptwriter_directives


# -------------------------------------------------- import-time validation
#
# Each of these would otherwise ship as a format that cannot produce a
# passing script, discovered only after a user paid for a render.


def _voice(wpm: int = 165) -> VoiceDirection:
    return VoiceDirection(persona="p", style_directions="s", words_per_minute=wpm)


def _fmt(contract: BeatContract, **kw) -> registry.VideoFormat:
    base = dict(
        key="probe",
        label="Probe",
        description="d",
        contract=contract,
        pacing=Pacing(beat_min_sec=4.0, beat_max_sec=7.0, shots_per_beat=2),
        voice=_voice(),
        target_duration_sec=20,
        suggested_scene_count=contract.min_beats,
    )
    base.update(kw)
    return registry.VideoFormat(**base)


def _spec(role: BeatRole, **kw) -> BeatSpec:
    return BeatSpec(role=role, label=role.value, purpose="do the thing", **kw)


def test_validation_rejects_duplicate_roles():
    contract = BeatContract(
        specs=[
            _spec(BeatRole.hook, requires_open_loop=True, max_duration_sec=4.0),
            _spec(BeatRole.hook),
            _spec(BeatRole.reveal),
        ],
        min_beats=3,
        max_beats=3,
    )
    with pytest.raises(ValueError, match="unique"):
        registry._validate_format(_fmt(contract))


def test_validation_rejects_a_script_that_never_closes():
    contract = BeatContract(
        specs=[_spec(BeatRole.hook), _spec(BeatRole.escalation)],
        min_beats=2,
        max_beats=2,
    )
    with pytest.raises(ValueError, match="close the loop"):
        registry._validate_format(_fmt(contract))


def test_validation_rejects_an_unsatisfiable_duration_cap():
    """The bug this guard was written for: a 3s hook cap inside a format
    whose shortest legal beat is 4s."""
    contract = BeatContract(
        specs=[_spec(BeatRole.hook, max_duration_sec=3.0), _spec(BeatRole.reveal)],
        min_beats=2,
        max_beats=2,
    )
    with pytest.raises(ValueError, match="shortest legal beat"):
        registry._validate_format(_fmt(contract))


def test_validation_rejects_two_flexible_slots():
    contract = BeatContract(
        specs=[
            _spec(BeatRole.hook),
            _spec(BeatRole.escalation, max_count=None),
            _spec(BeatRole.item, max_count=None),
            _spec(BeatRole.reveal),
        ],
        min_beats=4,
        max_beats=8,
    )
    with pytest.raises(ValueError, match="flexible"):
        registry._validate_format(_fmt(contract))


def test_validation_rejects_an_unreachable_target_duration():
    contract = BeatContract(
        specs=[_spec(BeatRole.hook), _spec(BeatRole.reveal)],
        min_beats=2,
        max_beats=2,
    )
    with pytest.raises(ValueError, match="outside the achievable"):
        registry._validate_format(_fmt(contract, target_duration_sec=90))


def test_validation_rejects_voice_and_pacing_disagreement():
    contract = BeatContract(
        specs=[_spec(BeatRole.hook), _spec(BeatRole.reveal)],
        min_beats=2,
        max_beats=2,
    )
    with pytest.raises(ValueError, match="wpm"):
        registry._validate_format(
            _fmt(contract, voice=_voice(wpm=60), target_duration_sec=10)
        )


def test_validation_rejects_beats_too_short_for_their_shots():
    contract = BeatContract(
        specs=[_spec(BeatRole.hook), _spec(BeatRole.reveal)],
        min_beats=2,
        max_beats=2,
    )
    pacing = Pacing(beat_min_sec=3.0, beat_max_sec=7.0, shots_per_beat=2, shot_min_sec=2.0)
    with pytest.raises(ValueError, match="cannot hold"):
        registry._validate_format(_fmt(contract, pacing=pacing))
