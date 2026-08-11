"""The beat layer: role assignment, shot planning, and script grading.

Pure functions over pure data — no fixtures, no I/O. These are the
checks the pipeline runs before spending, and the checks CI runs to grade
eval scripts, so they have to agree with `evals.script_checks` about the
numbers they share.
"""
from __future__ import annotations

import pytest

from marketer.evals.script_checks import HOOK_MAX_WORDS
from marketer.formats import beats
from marketer.formats.beats import BeatContract, BeatRole, BeatSpec, Pacing
from marketer.models import Idea, Scene, Script

# A three-slot contract with one flexible middle — the same shape every
# catalogued format is a variation on.
CONTRACT = BeatContract(
    specs=[
        BeatSpec(
            role=BeatRole.hook,
            label="Hook",
            purpose="open the loop",
            max_duration_sec=4.0,
            max_sentences=1,
            requires_open_loop=True,
        ),
        BeatSpec(
            role=BeatRole.escalation,
            label="Escalation",
            purpose="raise the stakes one step",
            max_count=None,
            max_sentences=2,
        ),
        BeatSpec(
            role=BeatRole.turn,
            label="Turn",
            purpose="re-earn attention",
            requires_question=True,
            max_sentences=2,
        ),
        BeatSpec(role=BeatRole.reveal, label="Payoff", purpose="close the loop"),
    ],
    min_beats=4,
    max_beats=7,
)

PACING = Pacing(
    beat_min_sec=4.0,
    beat_max_sec=6.0,
    shots_per_beat=2,
    shot_min_sec=2.0,
    shot_max_sec=4.0,
    words_per_sec_min=2.4,
    words_per_sec_max=3.0,
)


def _scene(index: int, narration: str, duration: float = 5.0) -> Scene:
    return Scene(
        index=index,
        narration=narration,
        visual_prompt="clay style, a small object",
        motion_prompt="slow push in",
        duration_sec=duration,
    )


def _script(scenes: list[Scene]) -> Script:
    return Script(
        idea=Idea(
            topic="t",
            angle="a",
            hook="why this happens",
            target_audience="x",
            why_it_works="curiosity",
        ),
        scenes=scenes,
        total_duration_sec=sum(s.duration_sec for s in scenes),
    )


# 13 words at 5.0s = 2.6 w/s, inside the pacing band.
_BODY = "this signal moves through the chamber and pushes the next valve open now."
_HOOK = "why does the smallest valve in the whole chamber fail first."
_TURN = "so what happens when the last valve gives out completely here now?"


def good_script(n: int = 4) -> Script:
    scenes = [_scene(0, _HOOK, 4.0)]
    for i in range(1, n - 2):
        scenes.append(_scene(i, _BODY))
    scenes.append(_scene(n - 2, _TURN))
    scenes.append(_scene(n - 1, _BODY))
    return _script(scenes)


# ------------------------------------------------------------ assign_roles


def test_assign_roles_fills_fixed_slots_in_order():
    roles = beats.assign_roles(4, CONTRACT)
    assert roles == [BeatRole.hook, BeatRole.escalation, BeatRole.turn, BeatRole.reveal]


def test_the_flexible_slot_absorbs_the_slack():
    roles = beats.assign_roles(7, CONTRACT)
    assert roles.count(BeatRole.escalation) == 4
    assert roles[0] is BeatRole.hook
    assert roles[-1] is BeatRole.reveal


def test_too_few_scenes_cannot_be_mapped():
    assert beats.assign_roles(3, CONTRACT) == []


def test_too_many_scenes_cannot_be_mapped_without_a_flexible_slot():
    fixed = BeatContract(
        specs=[
            BeatSpec(role=BeatRole.hook, label="Hook", purpose="open the loop"),
            BeatSpec(role=BeatRole.reveal, label="Payoff", purpose="close it"),
        ],
        min_beats=2,
        max_beats=2,
    )
    assert beats.assign_roles(2, fixed) == [BeatRole.hook, BeatRole.reveal]
    assert beats.assign_roles(3, fixed) == []


# -------------------------------------------------------------- plan_shots


def test_a_beat_is_split_into_establishing_plus_detail():
    """Two shots per beat is what turns narration into coverage; one held
    shot reads as a slideshow."""
    shots = beats.plan_shots(0, 6.0, PACING)
    assert [s.kind for s in shots] == ["establishing", "detail"]
    assert [s.duration_sec for s in shots] == [3.0, 3.0]


def test_shot_duration_is_clamped_to_the_cadence_window():
    long_beat = beats.plan_shots(0, 20.0, PACING)
    assert all(s.duration_sec == PACING.shot_max_sec for s in long_beat)
    short_beat = beats.plan_shots(0, 1.0, PACING)
    assert all(s.duration_sec == PACING.shot_min_sec for s in short_beat)


def test_camera_moves_rotate_across_beats_and_shots():
    """Repeating one move for a whole video is the tell of an
    auto-generated video."""
    first = [s.camera_move for s in beats.plan_shots(0, 6.0, PACING)]
    second = [s.camera_move for s in beats.plan_shots(1, 6.0, PACING)]
    assert len(set(first)) == 2
    assert first != second


def test_single_shot_pacing_produces_one_establishing_shot():
    single = PACING.model_copy(update={"shots_per_beat": 1, "shot_max_sec": 6.0})
    shots = beats.plan_shots(2, 5.0, single)
    assert len(shots) == 1
    assert shots[0].kind == "establishing"


# ------------------------------------------------------------ check_script


def test_a_conforming_script_has_no_issues():
    assert beats.check_script(good_script(), contract=CONTRACT, pacing=PACING) == []


def test_beat_count_outside_the_envelope_is_reported():
    issues = beats.check_script(good_script(7), contract=CONTRACT, pacing=PACING)
    assert issues == []
    too_many = _script([_scene(i, _BODY) for i in range(9)])
    issues = beats.check_script(too_many, contract=CONTRACT, pacing=PACING)
    assert any("4-7 beats" in i for i in issues)


def test_a_hook_that_takes_too_long_to_land_is_flagged():
    long_hook = " ".join(["why"] + ["word"] * HOOK_MAX_WORDS) + "."
    script = good_script()
    script.scenes[0] = _scene(0, long_hook, 4.0)
    issues = beats.check_script(script, contract=CONTRACT, pacing=PACING)
    assert any("hook" in i and "3 seconds" in i for i in issues)


def test_a_hook_that_closes_instead_of_opening_is_flagged():
    script = good_script()
    script.scenes[0] = _scene(0, "the valve simply wears out over time.", 4.0)
    issues = beats.check_script(script, contract=CONTRACT, pacing=PACING)
    assert any("opening a loop" in i for i in issues)


@pytest.mark.parametrize("marker", ["but", "turns out", "nobody", "?"])
def test_open_loop_markers_are_recognized(marker):
    text = f"the valve holds {marker} the pressure keeps climbing"
    assert beats._opens_loop(text)


def test_a_turn_without_a_question_mark_is_flagged():
    """The literal question is the pattern reset that re-earns the
    midpoint."""
    script = good_script()
    script.scenes[2] = _scene(2, _TURN.replace("?", "."))
    issues = beats.check_script(script, contract=CONTRACT, pacing=PACING)
    assert any("question mark" in i for i in issues)


def test_a_beat_carrying_two_ideas_is_flagged():
    script = good_script()
    script.scenes[0] = _scene(0, "why the valve fails. it corrodes.", 4.0)
    issues = beats.check_script(script, contract=CONTRACT, pacing=PACING)
    assert any("one beat carries one idea" in i for i in issues)


def test_a_beat_that_lingers_past_its_cap_is_flagged():
    script = good_script()
    script.scenes[0] = _scene(0, "why does the smallest valve in a chamber fail first here.", 5.0)
    issues = beats.check_script(script, contract=CONTRACT, pacing=PACING)
    assert any("exceeds 4.0s" in i for i in issues)


def test_a_beat_outside_the_pacing_window_is_flagged():
    script = good_script()
    script.scenes[1] = _scene(1, _BODY, 9.0)
    issues = beats.check_script(script, contract=CONTRACT, pacing=PACING)
    assert any("beat window" in i for i in issues)


def test_narration_pace_outside_the_format_band_is_flagged():
    script = good_script()
    script.scenes[1] = _scene(1, "three whole words.", 5.0)
    issues = beats.check_script(script, contract=CONTRACT, pacing=PACING)
    assert any("words/sec" in i for i in issues)


def test_a_script_that_ends_on_an_escalation_never_pays_off():
    open_ended = BeatContract(
        specs=[
            BeatSpec(
                role=BeatRole.hook,
                label="Hook",
                purpose="open the loop",
                requires_open_loop=True,
            ),
            BeatSpec(role=BeatRole.escalation, label="Escalation", purpose="raise it"),
        ],
        min_beats=2,
        max_beats=2,
    )
    script = _script([_scene(0, _HOOK), _scene(1, _BODY)])
    issues = beats.check_script(script, contract=open_ended, pacing=PACING)
    assert any("open loop is never closed" in i for i in issues)


def test_unmappable_scene_count_short_circuits_with_one_clear_issue():
    script = _script([_scene(0, _HOOK), _scene(1, _BODY)])
    issues = beats.check_script(script, contract=CONTRACT, pacing=PACING)
    assert any("cannot be mapped" in i for i in issues)
    # It stops there rather than emitting per-scene noise against roles
    # it could not assign.
    assert not any("words/sec" in i for i in issues)


# ------------------------------------------------------------- score_beats


def test_score_beats_envelope_matches_the_generic_grader():
    result = beats.score_beats(good_script(5), contract=CONTRACT, pacing=PACING)
    assert set(result) == {"issues", "passed", "metrics"}
    assert result["passed"] is True
    metrics = result["metrics"]
    assert metrics["beat_count"] == 5
    assert metrics["roles"][0] == "hook"
    assert metrics["roles"][-1] == "reveal"
    assert metrics["shot_count"] == 10  # 5 beats x 2 shots
    assert metrics["issue_count"] == 0
    assert 2.4 <= metrics["avg_words_per_sec"] <= 3.0


def test_score_beats_reports_failure_without_raising():
    bad = _script([_scene(0, "the valve wears out.", 12.0)])
    result = beats.score_beats(bad, contract=CONTRACT, pacing=PACING)
    assert result["passed"] is False
    assert result["metrics"]["issue_count"] == len(result["issues"]) > 0


# --------------------------------------------------------- summary shapes


def test_contract_summary_is_the_one_line_shape_for_the_catalog():
    assert CONTRACT.summary() == "Hook -> Escalation -> Turn -> Payoff"
    assert CONTRACT.total_min() == 4


def test_contract_summary_wire_shape_carries_purposes():
    summary = beats.contract_summary(CONTRACT)
    assert summary.structure == CONTRACT.summary()
    assert summary.beats[0].startswith("Hook: ")
    assert (summary.min_beats, summary.max_beats) == (4, 7)
