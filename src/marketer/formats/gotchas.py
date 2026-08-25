"""Per-model failure modes, and the prompt adjustments that avoid them.

This is operational knowledge, not configuration: every entry is a real
way a generation call comes back wrong, plus the phrasing that prevents
it. Prompt builders consult this so a known failure is designed out
*before* money is spent, instead of being discovered in the render.

Pure data + pure functions — no I/O, no network, no DB — so the pipeline
can import it on the hot path and tests can assert on it for free.

Scope note: this file knows about *prompting* failure modes. Hard request
constraints that the transport layer already enforces (duration enums,
input image sizes, allowed aspect ratios) live with their clients —
`services.fal_video` snaps durations and letterboxes Sora 2 inputs,
`ugc.catalog` validates UGC parameters. Where a transport constraint has
a *creative* consequence (Veo 3 only renders 8s, so a beat written for 4s
gets padded), it is repeated here as a `planning` gotcha with a pointer,
because the scriptwriter needs to know it and never sees the client.
"""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field

Stage = Literal["image", "video", "avatar", "tts", "captions", "planning"]
Severity = Literal["blocker", "degrades", "cosmetic"]


class ModelGotcha(BaseModel):
    """One known failure mode of one model family, and its workaround."""

    key: str
    # Model ids or id prefixes this applies to. "*" = every model at this
    # stage (universal craft rules — most drift failures are universal).
    models: tuple[str, ...]
    stage: Stage
    severity: Severity
    # What you actually see in the output when this bites.
    failure: str
    # Root cause, so a reader can generalize to a model not listed here.
    cause: str
    # The prompt-side fix, phrased as an instruction to whoever builds the
    # prompt. These strings are injected into agent prompts verbatim.
    rule: str
    # Terms whose presence in a prompt triggers the failure. Matched
    # case-insensitively on word boundaries.
    forbidden_terms: tuple[str, ...] = ()
    # Text appended to a prompt for this model when the gotcha applies.
    prompt_suffix: str = ""


# ---------------------------------------------------------------------------
# The knowledge base.
#
# Ordered roughly by how often each one ruins a render. Universal rules
# ("*") come first at each stage because they bite on every provider.

GOTCHAS: list[ModelGotcha] = [
    # -- image stage ------------------------------------------------------
    ModelGotcha(
        key="image.no-rendered-text",
        models=("*",),
        stage="image",
        severity="blocker",
        failure="Words in the frame come out as melted pseudo-lettering.",
        cause=(
            "Diffusion/autoregressive image models approximate glyphs; short "
            "labels sometimes survive, long ones never do."
        ),
        rule=(
            "Never ask for text, words, numbers, labels, captions, signs, or "
            "UI in a keyframe. Captions are burned in later by ffmpeg, where "
            "they are perfectly legible and restylable for free."
        ),
        forbidden_terms=(
            "text", "words", "caption", "captions", "subtitle", "subtitles",
            "label", "labels", "labeled", "typography", "lettering", "font",
            "headline", "sign that says", "speech bubble",
        ),
    ),
    ModelGotcha(
        key="image.character-drift",
        models=("*",),
        stage="image",
        severity="blocker",
        failure=(
            "The same character has a different face, hair, or outfit in "
            "every scene, so the video reads as a stock-image montage."
        ),
        cause=(
            "Each keyframe is an independent sample. A reference sheet "
            "conditions the model, but a prompt that says 'the same boy' "
            "carries no identity information on its own — the model has no "
            "memory of the previous frame."
        ),
        rule=(
            "Restate the cast's identity clause verbatim in EVERY scene "
            "prompt (same hair, same wardrobe, same build), alongside the "
            "reference sheet. Never write 'the same character as before'."
        ),
        forbidden_terms=("same character as before", "as in the previous scene"),
    ),
    ModelGotcha(
        key="image.style-drift",
        models=("*",),
        stage="image",
        severity="degrades",
        failure="Scene 4 is a photograph while scene 1 was an illustration.",
        cause=(
            "Style words late in a prompt get diluted by scene-specific "
            "detail, and each scene is sampled independently."
        ),
        rule=(
            "Open every visual_prompt with the identical style prefix (the "
            "first ~6 words), then the scene content. The evals enforce this "
            "prefix match; matching it is cheaper than failing QA."
        ),
    ),
    ModelGotcha(
        key="image.anatomy-safety-refusal",
        models=("gpt-image-1",),
        stage="image",
        severity="degrades",
        failure=(
            "Medical/anatomical cutaway prompts are refused by the safety "
            "system, costing a retry (or the scene)."
        ),
        cause=(
            "Interior-of-the-body language reads as gore to the moderation "
            "classifier, especially with blood, wounds, or surgical framing."
        ),
        rule=(
            "Frame anatomy as a clean educational model: 'stylized 3D medical "
            "illustration, cross-section cutaway, smooth matte surfaces, no "
            "blood, non-graphic, textbook diagram feel'. Never 'realistic', "
            "'gore', 'wound', 'bleeding', or 'surgery'."
        ),
        forbidden_terms=("gore", "gory", "wound", "bleeding", "blood", "surgery", "dissection"),
        prompt_suffix=(
            "Clean educational medical illustration, non-graphic, no blood, "
            "smooth stylized surfaces."
        ),
    ),
    ModelGotcha(
        key="image.reference-sheet-overpowers",
        models=("gpt-image-1",),
        stage="image",
        severity="cosmetic",
        failure=(
            "Every scene comes back looking like the turnaround sheet: "
            "flat lighting, neutral background, character facing forward."
        ),
        cause=(
            "A reference image conditions composition as well as identity, "
            "and a turnaround sheet's composition is 'catalog on grey'."
        ),
        rule=(
            "When passing a character sheet, state the scene's camera and "
            "environment explicitly and early ('low angle, inside a dim "
            "kitchen'), or the sheet's staging wins."
        ),
    ),

    # -- video (image-to-video) stage -------------------------------------
    ModelGotcha(
        key="video.motion-only",
        models=("*",),
        stage="video",
        severity="blocker",
        failure=(
            "The clip morphs: new objects grow out of the frame, the subject "
            "melts, the scene changes halfway through."
        ),
        cause=(
            "The keyframe already fixed the content. An i2v motion prompt "
            "that introduces NEW content forces the model to invent it "
            "mid-clip, and interpolation between two unrelated states is "
            "what morphing looks like."
        ),
        rule=(
            "The motion prompt describes MOTION ONLY — one camera move OR "
            "one subject motion, under 20 words. Never re-describe the "
            "scene, never add an object, never cut to something else."
        ),
        forbidden_terms=("then ", "cuts to", "transitions to", "appears", "turns into"),
    ),
    ModelGotcha(
        key="video.single-action",
        models=(
            "fal-ai/kling-video",
            "fal-ai/wan",
            "fal-ai/pixverse",
            "grok-imagine-video",
        ),
        stage="video",
        severity="degrades",
        failure=(
            "Two requested actions blend into one incoherent movement; hands "
            "and faces warp during the blend."
        ),
        cause=(
            "These models resolve a single dominant motion vector per clip; "
            "a compound instruction is averaged rather than sequenced."
        ),
        rule=(
            "One motion per clip. If a beat needs two actions, it needs two "
            "shots — which the beat layer already gives you."
        ),
    ),
    ModelGotcha(
        key="video.veo3-native-audio",
        models=("fal-ai/veo3", "fal-ai/veo3/fast", "veo3.1"),
        stage="video",
        severity="blocker",
        failure=(
            "The clip arrives with its own generated speech, ambience, or "
            "music that fights the narration track in the final mix."
        ),
        cause="Veo 3 generates audio by default and takes dialogue cues from the prompt.",
        rule=(
            "Keep generate_audio off (the fal registry already sets it) AND "
            "write no dialogue, no sound effects, and no 'he says' in the "
            "motion prompt — prompt-level audio cues also produce lip "
            "movement, which desyncs against our own voiceover."
        ),
        forbidden_terms=("says", "speaks", "dialogue", "voiceover", "sound of", "music plays"),
    ),
    ModelGotcha(
        key="video.veo3-fixed-8s",
        models=("fal-ai/veo3", "fal-ai/veo3/fast"),
        stage="planning",
        severity="degrades",
        failure=(
            "A 4-second beat renders as an 8-second clip that is trimmed or "
            "held, so the cut lands late and the narration drifts."
        ),
        cause="Veo 3's duration enum is a single value: 8s (sent as the string '8s').",
        rule=(
            "On Veo 3, write beats at ~8s or accept a trim. Prefer a "
            "shorter-cadence model (Kling, Pixverse) for fast-cut explainer "
            "formats. Transport detail — enum + '8s' suffix — is handled by "
            "services.fal_video.format_duration."
        ),
    ),
    ModelGotcha(
        key="video.hailuo-camera-drift",
        models=("fal-ai/minimax/hailuo-02",),
        stage="video",
        severity="cosmetic",
        failure="The camera wanders even when the beat wanted a locked frame.",
        cause="Hailuo adds expressive camera movement unless told not to.",
        rule="Say 'locked-off static camera' explicitly when a beat needs stillness.",
        prompt_suffix="",
    ),
    ModelGotcha(
        key="video.wan-fast-action",
        models=("fal-ai/wan",),
        stage="video",
        severity="degrades",
        failure="Fast action smears into unreadable mush.",
        cause="The budget open-weights model has the least temporal capacity of the set.",
        rule=(
            "On Wan, keep motion subtle — drifts, slow push-ins, small "
            "gestures. Route running, impacts, and whip pans to Kling or Veo."
        ),
        forbidden_terms=("running", "explosion", "whip pan", "fast", "rapidly", "smash"),
    ),
    ModelGotcha(
        key="video.pixverse-saturation",
        models=("fal-ai/pixverse",),
        stage="video",
        severity="cosmetic",
        failure="Colors bloom past the keyframe's grade; skin goes neon.",
        cause="Pixverse pushes stylized saturation, which stacks with saturated prompts.",
        rule="Don't stack 'vibrant', 'neon', and 'glowing' in a Pixverse motion prompt.",
        forbidden_terms=("vibrant", "neon", "glowing"),
    ),
    ModelGotcha(
        key="video.grok-simple-camera-language",
        models=("grok-imagine-video",),
        stage="video",
        severity="cosmetic",
        failure="Cinematographic jargon is ignored or produces a random move.",
        cause=(
            "Grok Imagine responds to plain motion language, not to lens/rig "
            "vocabulary ('dolly counter to a jib arc')."
        ),
        rule="Use one plain clause: 'slow push in', 'gentle pan right', 'subtle drift up'.",
    ),
    ModelGotcha(
        key="video.first-frame-is-the-look",
        models=("*",),
        stage="video",
        severity="degrades",
        failure="Lighting/style corrections in the motion prompt do nothing.",
        cause=(
            "i2v models treat the keyframe as ground truth for appearance; "
            "only motion is theirs to decide."
        ),
        rule=(
            "Fix the look at the keyframe stage. If a clip looks wrong, "
            "regenerate the image, not the animation."
        ),
    ),

    # -- avatar / lip-sync ------------------------------------------------
    ModelGotcha(
        key="avatar.audio-length-cap",
        models=("fal-ai/bytedance/omnihuman",),
        stage="avatar",
        severity="blocker",
        failure="The render is rejected after the keyframe and voiceover were already paid for.",
        cause="OmniHuman caps input audio at ~30s; render length follows the audio.",
        rule=(
            "Keep a lip-synced beat's narration under 30s of speech (~75 "
            "words). Split longer scripts across scenes."
        ),
    ),
    ModelGotcha(
        key="avatar.portrait-required",
        models=("fal-ai/bytedance/omnihuman",),
        stage="avatar",
        severity="blocker",
        failure="No lip movement, or a warped face.",
        cause="The model needs an unobstructed, roughly front-facing single face.",
        rule=(
            "Avatar keyframes must be a clean single-person portrait: face "
            "unobstructed, no profile, no crowd, no cross-section cutaway."
        ),
    ),

    # -- narration --------------------------------------------------------
    ModelGotcha(
        key="tts.stage-directions-are-read-aloud",
        models=("*",),
        stage="tts",
        severity="blocker",
        failure="The voiceover literally says 'pause' or 'excited tone'.",
        cause=(
            "Narration text is synthesized verbatim; performance notes belong "
            "in the style/voice-direction field, not in the script line."
        ),
        rule=(
            "Narration contains only spoken words. Put delivery notes in the "
            "voice direction, and never leave brackets or parentheses in a "
            "narration line."
        ),
        forbidden_terms=("[", "]", "(pause)", "(beat)", "narrator:", "voiceover:"),
    ),
    ModelGotcha(
        key="tts.symbols-and-abbreviations",
        models=("gpt-4o-mini-tts", "eleven_multilingual_v2"),
        stage="tts",
        severity="degrades",
        failure="'~3 cm' becomes 'tilde three see em'; '2019-2021' becomes a hyphen mumble.",
        cause="TTS expands symbols literally and guesses at abbreviations.",
        rule=(
            "Write numbers, units, and ranges the way they are spoken: "
            "'about three centimetres', 'twenty nineteen to twenty twenty one'."
        ),
        forbidden_terms=("~", "&", "%", "e.g.", "i.e.", "etc."),
    ),
    ModelGotcha(
        key="tts.em-dash-pauses",
        models=("*",),
        stage="tts",
        severity="cosmetic",
        failure="Em/en dashes produce a long dead pause mid-sentence.",
        cause=(
            "The models render a dash as a full stop's worth of silence, "
            "which breaks the momentum a fast explainer depends on."
        ),
        rule=(
            "Use commas or a new sentence instead of em/en dashes in "
            "narration. `articles.llm.strip_ai_dashes` is the deterministic "
            "backstop when the writer drifts."
        ),
        forbidden_terms=("—", "–"),
    ),

    # -- captions ---------------------------------------------------------
    ModelGotcha(
        key="captions.transcription-mismatch",
        models=("whisper-1",),
        stage="captions",
        severity="cosmetic",
        failure="Burned captions disagree with the narration on rare proper nouns.",
        cause=(
            "Captions are transcribed from the synthesized audio, not taken "
            "from the script, so an unusual word is re-guessed."
        ),
        rule=(
            "Prefer common words in narration; when a rare term is essential, "
            "expect the caption to differ and keep it short."
        ),
    ),
]

_BY_KEY = {g.key: g for g in GOTCHAS}


def get(key: str) -> ModelGotcha | None:
    return _BY_KEY.get(key)


def _matches(gotcha: ModelGotcha, model_id: str) -> bool:
    if "*" in gotcha.models:
        return True
    mid = (model_id or "").lower()
    # Prefix match: fal ids are paths ("fal-ai/kling-video/v2.1/...") and a
    # family-level entry must cover every variant under it.
    return any(mid.startswith(m.lower()) for m in gotcha.models)


def gotchas_for(model_id: str, *, stage: Stage | None = None) -> list[ModelGotcha]:
    """Every known failure mode for `model_id` (optionally one stage)."""
    return [
        g for g in GOTCHAS if _matches(g, model_id) and (stage is None or g.stage == stage)
    ]


def prompt_rules(model_id: str, *, stage: Stage | None = None) -> list[str]:
    """The rule lines to inject into a prompt builder for this model."""
    return [g.rule for g in gotchas_for(model_id, stage=stage)]


def rules_block(model_id: str, *, stage: Stage | None = None) -> str:
    """Rules as a prompt-ready block. Empty string when nothing applies."""
    rules = prompt_rules(model_id, stage=stage)
    if not rules:
        return ""
    head = f"MODEL CONSTRAINTS ({model_id}) — these prevent known failures:"
    return "\n".join([head, *(f"- {r}" for r in rules)])


def _term_pattern(term: str) -> re.Pattern[str]:
    # Word boundaries only make sense around word characters; punctuation
    # terms ("—", "[") must match literally or they'd never fire.
    if term[0].isalnum() and term[-1].isalnum():
        return re.compile(rf"\b{re.escape(term)}\b", re.IGNORECASE)
    return re.compile(re.escape(term), re.IGNORECASE)


def check_prompt(prompt: str, *, model_id: str, stage: Stage) -> list[str]:
    """Flag constructs in `prompt` that trip a known failure for this model.

    Returns issue strings naming the offending term, the failure it causes,
    and the fix — so a caller (or an agent re-prompt) can act on it. Pure
    string work: safe to run before every paid generation call.
    """
    issues: list[str] = []
    for g in gotchas_for(model_id, stage=stage):
        for term in g.forbidden_terms:
            if _term_pattern(term).search(prompt):
                issues.append(
                    f"[{g.key}] {term!r} in prompt: {g.failure} Fix: {g.rule}"
                )
                break  # one hit per gotcha is enough to act on
    return issues


def apply_prompt_rules(prompt: str, *, model_id: str, stage: Stage) -> tuple[str, list[str]]:
    """Return (adjusted prompt, notes) for this model at this stage.

    Only *additive* adjustments are applied automatically (appending a
    guard clause such as the non-graphic medical framing). Offending terms
    are reported, never silently deleted: removing a word from a creative
    prompt can change what the shot is, and that call belongs to the
    caller, not to a lookup table.
    """
    notes = check_prompt(prompt, model_id=model_id, stage=stage)
    adjusted = prompt
    for g in gotchas_for(model_id, stage=stage):
        if g.prompt_suffix and g.prompt_suffix.lower() not in adjusted.lower():
            adjusted = f"{adjusted.rstrip().rstrip('.')}. {g.prompt_suffix}"
            notes.append(f"[{g.key}] appended guard: {g.prompt_suffix}")
    return adjusted, notes


class GotchaSummary(BaseModel):
    """Wire shape for surfacing the KB in the API/UI."""

    key: str
    stage: Stage
    severity: Severity
    models: list[str] = Field(default_factory=list)
    failure: str
    rule: str


def summaries(*, stage: Stage | None = None) -> list[GotchaSummary]:
    return [
        GotchaSummary(
            key=g.key,
            stage=g.stage,
            severity=g.severity,
            models=list(g.models),
            failure=g.failure,
            rule=g.rule,
        )
        for g in GOTCHAS
        if stage is None or g.stage == stage
    ]
