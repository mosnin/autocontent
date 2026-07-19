"""Creative DNA: model validation + the prompt fragments each agent gets."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from marketer.models import CreativeBrief
from marketer.models.creative_brief import MECHANISM_LENSES


def _full_brief() -> CreativeBrief:
    return CreativeBrief.model_validate({
        "hooks": {
            "preferred_mechanisms": ["story_cold_open", "myth_bust"],
            "banned_openers": ["did you know"],
            "example_hooks": ["the $3 mistake in every portfolio"],
        },
        "narrative": {
            "language": "Spanish",
            "pov": "first-person operator",
            "pacing": "rapid-fire",
            "reading_level": "5th grade",
            "cta_policy": "never",
            "must_avoid": ["politics"],
        },
        "visual": {
            "camera_language": "slow push-ins only",
            "lighting": "golden hour",
            "color_palette": "terracotta + cream",
            "negative_visuals": ["logos", "crowds"],
        },
        "audio": {
            "music_enabled": False,
            "music_mood": "lofi calm",
            "caption_style": {
                "font": "Impact", "font_size": 120, "text_hex": "FFE14D",
                "uppercase": True, "position": "center",
            },
        },
        "prompt_overrides": {
            "ideation": "always angle toward beginners",
            "scriptwriter": "end scenes on questions",
            "visual_director": "include the neon studio sign",
        },
    })


def test_default_brief_is_default_and_produces_no_fragments():
    b = CreativeBrief()
    assert b.is_default()
    assert b.ideation_lines() == []
    assert b.scriptwriter_lines() == []
    assert b.visual_director_brief() == {}
    assert b.qa_lines() == []
    assert b.candidate_lenses() == []


def test_extra_fields_rejected_loudly():
    with pytest.raises(ValidationError):
        CreativeBrief.model_validate({"hooks": {"prefered_mechanisms": []}})  # typo
    with pytest.raises(ValidationError):
        CreativeBrief.model_validate({"narrative": {"langauge": "es"}})  # typo


def test_unknown_mechanism_rejected():
    with pytest.raises(ValidationError):
        CreativeBrief.model_validate(
            {"hooks": {"preferred_mechanisms": ["jump_scare"]}}
        )


def test_ideation_lines_carry_language_examples_and_override():
    lines = "\n".join(_full_brief().ideation_lines())
    assert "Spanish" in lines
    assert "did you know" in lines
    assert "the $3 mistake in every portfolio" in lines
    assert "politics" in lines
    assert "always angle toward beginners" in lines


def test_candidate_lenses_restricted_to_preferred_mechanisms():
    lenses = _full_brief().candidate_lenses()
    assert lenses == [
        MECHANISM_LENSES["story_cold_open"],
        MECHANISM_LENSES["myth_bust"],
    ]


def test_scriptwriter_lines_cover_narrative_and_override():
    lines = "\n".join(_full_brief().scriptwriter_lines())
    for expected in ("Spanish", "first-person operator", "rapid-fire",
                     "5th grade", "never", "politics", "end scenes on questions"):
        assert expected in lines


def test_visual_director_brief_drops_empty_keys():
    vd = _full_brief().visual_director_brief()
    assert vd == {
        "camera_language": "slow push-ins only",
        "lighting": "golden hour",
        "color_palette": "terracotta + cream",
        "never_show": ["logos", "crowds"],
        "extra_instructions": "include the neon studio sign",
    }
    assert CreativeBrief().visual_director_brief() == {}


def test_qa_lines_protect_language_and_ban_topics():
    lines = "\n".join(_full_brief().qa_lines())
    assert "Spanish" in lines and "drift" in lines
    assert "politics" in lines


def test_prompt_override_length_bounded():
    with pytest.raises(ValidationError):
        CreativeBrief.model_validate(
            {"prompt_overrides": {"scriptwriter": "x" * 2001}}
        )


# --------------------------------------------------------------------------- threading

async def test_ideation_prompt_includes_brief_and_tournament_uses_its_lenses(
    monkeypatch,
):
    from marketer.config import settings
    from marketer.models import Idea
    import marketer.orchestrator as _orch
    from agents import Runner

    monkeypatch.setattr(settings, "ideation_candidates", 2)
    brief = _full_brief()

    captured: list[str] = []

    class _Result:
        def __init__(self, output):
            self._output = output
            self.context_wrapper = type("W", (), {"usage": type(
                "U", (), {"total_tokens": 1, "input_tokens": 1, "output_tokens": 0})()})()

        def final_output_as(self, cls):
            return self._output

    from marketer.agents.ideation import IdeaVerdict

    async def fake_run(agent, *, input):  # noqa: A002
        captured.append(input)
        if agent.name == "IdeaJudge":
            return _Result(IdeaVerdict(winner_index=0, reasoning="r"))
        return _Result(Idea(topic="t", angle="a", hook="h",
                            target_audience="x", why_it_works="y"))

    monkeypatch.setattr(Runner, "run", fake_run)

    await _orch.run_ideation("niche", brief=brief)

    candidate_prompts = captured[:2]
    # brief lines present in every candidate prompt
    assert all("Spanish" in p for p in candidate_prompts)
    # lenses come from the brief's preferred mechanisms, not the stock set
    assert MECHANISM_LENSES["story_cold_open"] in candidate_prompts[0]
    assert MECHANISM_LENSES["myth_bust"] in candidate_prompts[1]


async def test_scriptwriter_and_vd_receive_brief(monkeypatch):
    import json

    from marketer.models import Idea, Scene, Script
    import marketer.orchestrator as _orch
    from agents import Runner

    script = Script(
        idea=Idea(topic="t", angle="a", hook="h", target_audience="x",
                  why_it_works="y"),
        scenes=[Scene(index=0, narration="n", visual_prompt="v",
                      motion_prompt="m", duration_sec=5)],
        total_duration_sec=5,
    )
    captured: list[tuple[str, str]] = []

    class _Result:
        def __init__(self, output):
            self._output = output
            self.context_wrapper = type("W", (), {"usage": type(
                "U", (), {"total_tokens": 1, "input_tokens": 1, "output_tokens": 0})()})()

        def final_output_as(self, cls):
            return self._output

    async def fake_run(agent, *, input):  # noqa: A002
        captured.append((agent.name, input))
        return _Result(script)

    monkeypatch.setattr(Runner, "run", fake_run)
    brief = _full_brief()

    await _orch.run_scriptwriter(
        script.idea, scene_count=1, target_duration_sec=5, brief=brief
    )
    await _orch.run_visual_director(
        script, visual_style="clay", character_description="Sol the llama",
        brief=brief,
    )

    sw_prompt = next(p for name, p in captured if name == "Scriptwriter")
    assert "rapid-fire" in sw_prompt and "end scenes on questions" in sw_prompt

    vd_payload = json.loads(next(p for name, p in captured if name == "VisualDirector"))
    assert vd_payload["character"] == "Sol the llama"
    assert vd_payload["creative_brief"]["never_show"] == ["logos", "crowds"]
    assert vd_payload["creative_brief"]["camera_language"] == "slow push-ins only"
