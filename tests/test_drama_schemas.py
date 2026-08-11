"""Schema-level invariants for micro-dramas.

These pin the *money* invariants that live in the schema layer: shot counts
and cast sizes are hard-bounded here, not just requested in a prompt, because
each extra shot is one more image AND one more video generation.
"""
from __future__ import annotations

from marketer.drama.schemas import (
    MAX_CAST,
    MAX_SHOT_SEC,
    MAX_SHOTS,
    MIN_SHOT_SEC,
    MIN_SHOTS,
    CastDraft,
    Character,
    CharacterDraft,
    Drama,
    DramaPlan,
    DramaStatus,
    Screenplay,
    ScreenplayDraft,
    Shot,
    ShotDraft,
    ShotPromptDraft,
    StoryboardDraft,
    cast_from_draft,
    character_id,
    clamp_duration,
    clamp_shot_count,
    merge_storyboard,
    shots_from_screenplay,
)
from uuid import uuid4


def test_character_id_is_a_stable_slug():
    assert character_id("Mei Lin") == "mei-lin"
    assert character_id("  DR. O'Hara ") == "dr-o-hara"
    # Same name -> same id on a later attempt: this is what lets a resume map
    # a character back onto its already-paid portrait file.
    assert character_id("Mei Lin") == character_id("mei lin")
    assert character_id("!!!") == "character"


def test_clamp_shot_count_bounds_the_fanout():
    assert clamp_shot_count(1) == MIN_SHOTS
    assert clamp_shot_count(999) == MAX_SHOTS
    assert clamp_shot_count(6) == 6


def test_clamp_duration_bounds_clip_length():
    assert clamp_duration(0.1) == MIN_SHOT_SEC
    assert clamp_duration(60) == MAX_SHOT_SEC


def test_cast_from_draft_dedupes_and_bounds():
    draft = CastDraft(
        characters=[
            CharacterDraft(name="Mei", static_features="30s, short black hair"),
            # Same person spelled differently — one portrait, not two.
            CharacterDraft(name="mei", static_features="duplicate"),
            *[
                CharacterDraft(name=f"Extra{i}", static_features="x")
                for i in range(MAX_CAST + 3)
            ],
        ]
    )
    cast = cast_from_draft(draft)
    assert len(cast) == MAX_CAST
    assert [c.id for c in cast].count("mei") == 1
    assert cast[0].static_features == "30s, short black hair"


def test_shots_from_screenplay_truncates_and_reindexes():
    draft = ScreenplayDraft(
        title="t",
        logline="l",
        shots=[
            ShotDraft(
                index=90 + i,
                slugline=f"INT. ROOM {i}",
                action="a",
                character_names=["Mei Lin"],
                duration_sec=99.0,
            )
            for i in range(10)
        ],
    )
    shots = shots_from_screenplay(draft, shot_count=4)
    assert [s.index for s in shots] == [0, 1, 2, 3]
    assert shots[0].character_ids == ["mei-lin"]
    # Model-supplied durations never escape the clip bounds.
    assert all(s.duration_sec == MAX_SHOT_SEC for s in shots)


def test_merge_storyboard_keeps_writer_fields_and_drops_unknown_cast():
    cast = [Character(id="mei", name="Mei", static_features="s")]
    shots = [
        Shot(index=0, slugline="INT. BAR", action="writer action", dialogue="hi",
             character_ids=["mei"]),
        Shot(index=1, slugline="EXT. ALLEY", action="second", character_ids=["mei"]),
    ]
    draft = StoryboardDraft(
        shots=[
            ShotPromptDraft(
                index=0, slugline="OVERWRITTEN", action="overwritten",
                visual_prompt="vp0", motion_prompt="mp0",
                character_names=["Ghost"], duration_sec=4,
            ),
            ShotPromptDraft(
                index=1, visual_prompt="vp1", motion_prompt="mp1",
                character_names=["Ghost"], duration_sec=4,
            ),
        ]
    )
    merged = merge_storyboard(shots, draft, cast=cast, shot_count=6)
    assert [s.visual_prompt for s in merged] == ["vp0", "vp1"]
    # Writer's slugline/dialogue survive so the VO track still matches.
    assert merged[0].slugline == "INT. BAR"
    assert merged[0].dialogue == "hi"
    # A hallucinated cast id would silently disable character steering.
    assert merged[0].character_ids == ["mei"]


def test_merge_storyboard_from_empty_shot_list_is_bounded():
    """The script-supplied path has no writer shots; the storyboard's own
    shots become the list but must still respect shot_count."""
    draft = StoryboardDraft(
        shots=[
            ShotPromptDraft(index=i, visual_prompt=f"vp{i}", motion_prompt="m")
            for i in range(10)
        ]
    )
    merged = merge_storyboard([], draft, cast=[], shot_count=3)
    assert len(merged) == 3
    assert [s.index for s in merged] == [0, 1, 2]


def test_screenplay_as_prompt_text_prefers_supplied_script():
    sp = Screenplay(
        title="T", logline="L", beats=["b1"], source="script", script_text="RAW"
    )
    assert sp.as_prompt_text() == "RAW"
    sp2 = Screenplay(title="T", logline="L", beats=["b1"])
    assert "TITLE: T" in sp2.as_prompt_text()
    assert "b1" in sp2.as_prompt_text()


def test_plan_helpers():
    cast = [
        Character(id="mei", name="Mei", static_features="s", wardrobe="red coat"),
        Character(id="sam", name="Sam", static_features="t"),
    ]
    plan = DramaPlan(
        cast=cast,
        shots=[
            Shot(index=0, character_ids=["mei"], dialogue="one", clip_path="/a.mp4"),
            Shot(index=1, character_ids=["mei", "sam"], dialogue="two"),
        ],
    )
    assert plan.character_by_id("mei") is cast[0]
    assert plan.character_by_id("nope") is None
    assert [c.id for c in plan.characters_in(plan.shots[1])] == ["mei", "sam"]
    assert [s.index for s in plan.rendered_shots] == [0]
    assert plan.dialogue_text == "one two"
    assert "red coat" in cast[0].prompt_fragment()


def test_shot_progress_flags():
    shot = Shot(index=0)
    assert not shot.has_prompts and not shot.is_rendered
    assert shot.model_copy(update={"visual_prompt": "v"}).has_prompts
    assert shot.model_copy(update={"clip_path": "/x.mp4"}).is_rendered


def test_drama_row_defaults_and_plan_roundtrip():
    drama = Drama(id=uuid4(), user_id="u", niche_id=uuid4())
    assert drama.status is DramaStatus.queued
    assert drama.plan.screenplay is None
    restored = Drama.model_validate_json(drama.model_dump_json())
    assert restored.plan == drama.plan
    assert restored.aspect == "9:16"
