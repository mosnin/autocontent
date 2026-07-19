from __future__ import annotations

from marketer.evals import (
    check_duration,
    check_hook,
    check_pacing,
    check_style_cohesion,
    check_visual_prompts,
    score_script,
)
from marketer.models import Idea, Scene, Script

STYLE = "3D claymation style, soft studio lighting,"


def make_idea(hook: str = "Your budget lies to you every month") -> Idea:
    return Idea(
        topic="personal finance",
        angle="budgets fail because of invisible recurring spend",
        hook=hook,
        target_audience="mid-20s salaried workers new to budgeting",
        why_it_works="curiosity gap plus loss aversion drives the first 3s hold",
    )


def make_scene(
    index: int = 0,
    *,
    narration: str = "Your budget breaks because of five tiny invisible charges.",
    visual_prompt: str | None = None,
    motion_prompt: str = "slow push-in on the llama's face",
    duration_sec: float = 4.0,
) -> Scene:
    if visual_prompt is None:
        visual_prompt = f"{STYLE} a clay llama inspecting a giant coin, 9:16 vertical"
    return Scene(
        index=index,
        narration=narration,
        visual_prompt=visual_prompt,
        motion_prompt=motion_prompt,
        duration_sec=duration_sec,
    )


def make_script(scenes: list[Scene] | None = None, *, idea: Idea | None = None) -> Script:
    if scenes is None:
        scenes = [
            make_scene(0),
            make_scene(
                1,
                narration="Streaming, cloud storage, and app trials quietly stack up fast.",
                visual_prompt=f"{STYLE} a clay llama buried under falling coins, 9:16 vertical",
                motion_prompt="gentle parallax as coins drift down",
            ),
            make_scene(
                2,
                narration="Cancel one small charge today and redirect it into savings.",
                visual_prompt=f"{STYLE} a clay llama planting a coin like a seed, 9:16 vertical",
                motion_prompt="slow tilt up from the soil",
            ),
        ]
    script = Script(
        idea=idea or make_idea(),
        scenes=scenes,
        total_duration_sec=sum(s.duration_sec for s in scenes),
        cta="follow for part 2",
    )
    return script


# ---------------------------------------------------------------- check_hook


def test_good_hook_passes():
    assert check_hook(make_idea()) == []


def test_hook_too_long_flagged():
    hook = "this hook rambles on and on and on with far too many words in it"
    issues = check_hook(make_idea(hook))
    assert len(issues) == 1
    assert "words" in issues[0]


def test_hook_exactly_twelve_words_passes():
    hook = "one two three four five six seven eight nine ten eleven twelve"
    assert check_hook(make_idea(hook)) == []


def test_banned_openers_flagged():
    for opener in ("Hey guys, listen up", "In this video I show", "Today we learn X",
                   "Welcome back to the channel"):
        issues = check_hook(make_idea(opener))
        assert any("banned generic opener" in i for i in issues), opener


def test_banned_opener_case_insensitive():
    issues = check_hook(make_idea("HEY GUYS you need this"))
    assert any("banned generic opener" in i for i in issues)


def test_long_hook_with_banned_opener_yields_both_issues():
    hook = "hey guys in this video today we cover many many many too many words"
    issues = check_hook(make_idea(hook))
    assert len(issues) == 4  # length + three banned phrases


# -------------------------------------------------------------- check_pacing


def test_good_pacing_passes():
    assert check_pacing(make_script()) == []


def test_too_fast_narration_flagged():
    fast = make_scene(
        0,
        narration=" ".join(["word"] * 20),  # 20 words / 4s = 5 wps
        duration_sec=4.0,
    )
    issues = check_pacing(make_script([fast]))
    assert len(issues) == 1
    assert "pacing" in issues[0]
    assert "scene 0" in issues[0]


def test_too_slow_narration_flagged():
    slow = make_scene(0, narration="only three words", duration_sec=6.0)  # 0.5 wps
    issues = check_pacing(make_script([slow]))
    assert len(issues) == 1


def test_pacing_boundaries_inclusive():
    lo = make_scene(0, narration=" ".join(["w"] * 8), duration_sec=5.0)   # 1.6 wps
    hi = make_scene(1, narration=" ".join(["w"] * 17), duration_sec=5.0)  # 3.4 wps
    assert check_pacing(make_script([lo, hi])) == []


def test_zero_duration_scene_flagged_not_crashing():
    scene = make_scene(0, duration_sec=0.0)
    issues = check_pacing(make_script([scene]))
    assert any("non-positive duration" in i for i in issues)


# ------------------------------------------------------------ check_duration


def test_duration_on_target_passes():
    assert check_duration(make_script(), target_duration_sec=12.0) == []


def test_duration_within_20_percent_passes():
    # 3 scenes x 4s = 12s; target 14s -> ~14.3% drift
    assert check_duration(make_script(), target_duration_sec=14.0) == []


def test_duration_drift_beyond_20_percent_flagged():
    issues = check_duration(make_script(), target_duration_sec=30.0)
    assert any("off target" in i for i in issues)


def test_scene_too_short_flagged():
    short = make_scene(0, narration="four words spoken here", duration_sec=1.5)
    issues = check_duration(make_script([short]), target_duration_sec=1.5)
    assert any("outside" in i and "scene 0" in i for i in issues)


def test_scene_too_long_flagged():
    long = make_scene(0, duration_sec=8.0)
    issues = check_duration(make_script([long]), target_duration_sec=8.0)
    assert any("outside" in i for i in issues)


def test_scene_boundaries_inclusive():
    scenes = [
        make_scene(0, narration="five quick words spoken now", duration_sec=2.0),
        make_scene(
            1,
            narration=" ".join(["w"] * 14),
            visual_prompt=f"{STYLE} a clay llama waving, 9:16 vertical",
            duration_sec=7.0,
        ),
    ]
    assert check_duration(make_script(scenes), target_duration_sec=9.0) == []


# ------------------------------------------------------ check_visual_prompts


def test_clean_visual_prompts_pass():
    assert check_visual_prompts(make_script()) == []


def test_rendered_text_requests_flagged():
    bad_prompts = [
        f"{STYLE} a chalkboard with the words 'SAVE MORE' on it",
        f"{STYLE} a poster with bold typography about saving",
        f"{STYLE} a phone screen showing captions",
        f"{STYLE} a jar with a label reading savings",
        f"{STYLE} a title card introducing the topic",
    ]
    for prompt in bad_prompts:
        scene = make_scene(0, visual_prompt=prompt)
        issues = check_visual_prompts(make_script([scene]))
        assert any("rendered text" in i for i in issues), prompt


def test_empty_motion_prompt_flagged():
    scene = make_scene(0, motion_prompt="   ")
    issues = check_visual_prompts(make_script([scene]))
    assert any("empty motion_prompt" in i for i in issues)


def test_long_motion_prompt_flagged():
    scene = make_scene(0, motion_prompt=" ".join(["move"] * 21))
    issues = check_visual_prompts(make_script([scene]))
    assert any("motion_prompt is 21 words" in i for i in issues)


def test_motion_prompt_exactly_20_words_passes():
    scene = make_scene(0, motion_prompt=" ".join(["move"] * 20))
    assert check_visual_prompts(make_script([scene])) == []


# ----------------------------------------------------- check_style_cohesion


def test_cohesive_style_passes():
    assert check_style_cohesion(make_script()) == []


def test_style_prefix_case_insensitive():
    scenes = [
        make_scene(0, visual_prompt=f"{STYLE} a clay llama, 9:16 vertical"),
        make_scene(1, visual_prompt=f"{STYLE.upper()} a clay coin, 9:16 vertical"),
    ]
    assert check_style_cohesion(make_script(scenes)) == []


def test_style_break_flagged():
    scenes = [
        make_scene(0),
        make_scene(
            1,
            visual_prompt="cinematic photo of a mountain highway at dusk, 9:16 vertical",
        ),
    ]
    issues = check_style_cohesion(make_script(scenes))
    assert len(issues) == 1
    assert "scene 1" in issues[0]


def test_single_scene_script_has_no_cohesion_issues():
    assert check_style_cohesion(make_script([make_scene(0)])) == []


# ---------------------------------------------------------------- score_script


def test_score_script_good_passes_with_metrics():
    result = score_script(make_script(), target_duration_sec=12.0)
    assert result["passed"] is True
    assert result["issues"] == []
    metrics = result["metrics"]
    assert metrics["scene_count"] == 3
    assert metrics["total_duration_sec"] == 12.0
    assert metrics["duration_drift_frac"] == 0.0
    assert 1.6 <= metrics["avg_words_per_sec"] <= 3.4
    assert metrics["hook_word_count"] == 7
    assert metrics["issue_count"] == 0


def test_score_script_aggregates_all_check_families():
    scenes = [
        make_scene(
            0,
            narration="hi",  # too slow
            visual_prompt="a poster with big text saying BUY NOW",  # rendered text
            motion_prompt="",  # empty
            duration_sec=8.0,  # scene too long
        ),
        make_scene(
            1,
            visual_prompt="cinematic photo of a beach, 9:16 vertical",  # style break
        ),
    ]
    idea = make_idea("hey guys welcome back to another one of these long videos today")
    result = score_script(make_script(scenes, idea=idea), target_duration_sec=30.0)
    assert result["passed"] is False
    issues = "\n".join(result["issues"])
    assert "banned generic opener" in issues
    assert "pacing" in issues
    assert "off target" in issues
    assert "outside" in issues
    assert "rendered text" in issues
    assert "empty motion_prompt" in issues
    assert "style prefix" in issues
    assert result["metrics"]["issue_count"] == len(result["issues"])


def test_score_script_empty_scenes_does_not_crash():
    script = Script(idea=make_idea(), scenes=[], total_duration_sec=0.0)
    result = score_script(script, target_duration_sec=30.0)
    assert result["passed"] is False  # duration drift is 100%
    assert result["metrics"]["avg_words_per_sec"] == 0.0
