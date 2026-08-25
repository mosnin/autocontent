"""The video FORMAT catalog.

A *format* is the narrative shape of a short: the ordered beats it owes
the viewer, the cut cadence those beats are written to, the duration
envelope they fit in, and how the narration is performed. Picking a
format is the highest-leverage creative decision after the idea itself —
the same topic written as a myth-buster and as a listicle are different
videos with different retention curves.

The registry is code, not DB, exactly like `marketer.style_presets` and
`marketer.cinema.presets`: formats are product content that ships and
versions with the app, and the pipeline must be able to import them at
module scope. Pure data + pure functions — no I/O, no network, no DB.

What each format is built from
------------------------------
* a :class:`~marketer.formats.beats.BeatContract` — the slots a script
  must fill, which `beats.check_script` grades a generated script against;
* a :class:`~marketer.formats.beats.Pacing` — cut cadence and the
  narration-rate envelope, which is also what `plan_shots` reads;
* a :class:`~marketer.formats.beats.VoiceDirection` — how the narration
  is performed, because delivery and cut cadence are one decision.

`explainer` (the narrated documentary) keeps its craft in its own module;
the rest are defined here as deliberate variations on it.
"""
from __future__ import annotations

import re

from pydantic import BaseModel, Field

from ..models import Script
from . import explainer, gotchas
from .beats import (
    BeatContract,
    BeatContractSummary,
    BeatRole,
    BeatSpec,
    Pacing,
    VoiceDirection,
    assign_roles,
    contract_summary,
    score_beats,
)


class UnknownFormatKey(ValueError):
    """A caller asked for a format key that does not exist.

    Raised rather than silently defaulting: silently writing an explainer
    when the user picked a listicle is a wrong video that still costs a
    full render.
    """


class VideoFormat(BaseModel):
    """One narrative shape, complete enough to write and grade a script."""

    key: str
    label: str
    description: str
    contract: BeatContract
    pacing: Pacing
    voice: VoiceDirection
    # The duration this format is *written* for. A format is only honest
    # inside its envelope: a 5-beat myth-buster stretched to 60s is a
    # 60-second video with 30 seconds of padding in the middle.
    target_duration_sec: int
    # What to seed `niche.scene_count` with when this format is picked.
    suggested_scene_count: int
    # Plain-language "use this when…" lines for the picker.
    best_for: tuple[str, ...] = ()
    # Format-specific scriptwriter prompt block, injected verbatim.
    instructions: str = ""


# ---------------------------------------------------------------------------
# Shared pacing pieces
#
# Two shots per beat (establishing frame, then a detail/cutaway that goes
# inside it) is the documentary cadence; one shot per beat is the right
# call whenever cutting *inside* a beat would break what the beat is
# doing — a list item is one image, a demonstrated step is one continuous
# action, and a lip-synced face cut mid-sentence costs a second avatar
# render of the same line.


_MYTH_BUSTER = BeatContract(
    specs=[
        BeatSpec(
            role=BeatRole.hook,
            label="Myth",
            purpose=(
                "State the belief the audience already holds, in their "
                "words, and cast doubt on it in the same breath."
            ),
            # The shortest legal beat of the format (see explainer.py):
            # the 3-second audition is enforced in words, not seconds.
            max_duration_sec=4.0,
            max_sentences=1,
            requires_open_loop=True,
        ),
        BeatSpec(
            role=BeatRole.context,
            label="Mechanism",
            purpose=(
                "Explain what actually happens first — the real process the "
                "myth is a distortion of. This is what earns the right to "
                "correct the viewer."
            ),
            max_sentences=2,
        ),
        BeatSpec(
            role=BeatRole.escalation,
            label="Escalation",
            purpose=(
                "Push the process to the point where the myth looks like it "
                "might be true after all. Concede the strongest version of "
                "it here, or the verdict feels like a strawman."
            ),
            max_sentences=2,
        ),
        BeatSpec(
            role=BeatRole.turn,
            label="Twist",
            purpose=(
                "Break the expectation just built, and ask the question the "
                "verdict answers."
            ),
            requires_question=True,
            max_sentences=2,
        ),
        BeatSpec(
            role=BeatRole.reveal,
            label="Verdict",
            purpose=(
                "Rule on the myth in one plain sentence, then give the one "
                "concrete detail that makes the ruling stick."
            ),
            max_sentences=2,
        ),
    ],
    # Exactly five, no flexible slot. The myth-buster is a five-line
    # syllogism; a sixth beat pushes the verdict past ~35 seconds, and a
    # myth video that has not ruled by then reads as bait.
    min_beats=5,
    max_beats=5,
)


_WHAT_IF = BeatContract(
    specs=[
        BeatSpec(
            role=BeatRole.hook,
            label="Premise",
            purpose=(
                "Name the scenario and promise a consequence without naming "
                "it. The promise is the contract; the viewer stays to "
                "collect."
            ),
            max_duration_sec=4.0,
            max_sentences=1,
            requires_open_loop=True,
        ),
        BeatSpec(
            role=BeatRole.escalation,
            label="Step",
            purpose=(
                "One link in the causal chain, in strict order: what "
                "happens, then what that causes. Never skip a link — a "
                "chain with a gap is where the viewer stops believing it."
            ),
            # The chain is the format, so its length is what flexes.
            max_count=None,
            max_sentences=2,
        ),
        BeatSpec(
            role=BeatRole.turn,
            label="Point of no return",
            purpose=(
                "The step where the process stops being reversible or "
                "stops being survivable. Slow down here; this is the beat "
                "the video gets clipped and shared for."
            ),
            max_sentences=2,
        ),
        BeatSpec(
            role=BeatRole.reveal,
            label="Consequence",
            purpose=(
                "Deliver the promised outcome plainly, with the number or "
                "duration that makes it real."
            ),
            max_sentences=2,
        ),
    ],
    min_beats=4,
    max_beats=7,
)


_LISTICLE = BeatContract(
    specs=[
        BeatSpec(
            role=BeatRole.hook,
            label="Count promise",
            purpose=(
                "Say how many things are coming and who they are for. The "
                "count is the retention contract: a viewer who knows there "
                "are five will wait for the fifth."
            ),
            max_duration_sec=3.0,
            max_sentences=1,
            requires_open_loop=True,
        ),
        BeatSpec(
            role=BeatRole.item,
            label="Item",
            purpose=(
                "One item: name it, then give the single reason it matters. "
                "Order the items so the strongest is LAST — a list that "
                "front-loads its best item has nothing left to hold anyone."
            ),
            # Three is the floor: two items is a comparison, not a list.
            min_count=3,
            max_count=None,
            max_sentences=2,
        ),
        BeatSpec(
            role=BeatRole.button,
            label="Button",
            purpose=(
                "Close on the last item's consequence, or on the one line "
                "that ties the list together. Never recap the list — the "
                "recap is where every listicle loses its ending."
            ),
            max_sentences=2,
        ),
    ],
    min_beats=5,
    max_beats=9,
)


_TUTORIAL = BeatContract(
    specs=[
        BeatSpec(
            role=BeatRole.hook,
            label="Promise",
            purpose=(
                "Name the outcome and the time or effort it takes. A "
                "tutorial hook that hides the payoff has no reason to be "
                "watched over the finished-result video next to it."
            ),
            max_duration_sec=3.0,
            max_sentences=1,
            requires_open_loop=True,
        ),
        BeatSpec(
            role=BeatRole.context,
            label="Setup",
            purpose=(
                "What the viewer needs and where they are starting from. "
                "Skipping this is why tutorials get 'this didn't work for "
                "me' comments."
            ),
            max_sentences=2,
        ),
        BeatSpec(
            role=BeatRole.item,
            label="Step",
            purpose=(
                "One action, in the order it is performed, phrased as an "
                "imperative the viewer can follow while watching."
            ),
            min_count=2,
            max_count=None,
            max_sentences=2,
        ),
        BeatSpec(
            role=BeatRole.reveal,
            label="Result",
            purpose=(
                "Show the finished outcome and name the one thing that "
                "proves it worked."
            ),
            max_sentences=2,
        ),
        BeatSpec(
            role=BeatRole.cta,
            label="Next",
            purpose=(
                "One next action that serves retention (the harder variant, "
                "the part-two). Never a generic 'like and subscribe'."
            ),
            max_sentences=1,
        ),
    ],
    min_beats=6,
    max_beats=9,
)


_TESTIMONIAL = BeatContract(
    specs=[
        BeatSpec(
            role=BeatRole.hook,
            label="Cold open",
            purpose=(
                "First person, mid-thought, as if the camera caught the "
                "sentence already in progress. A greeting or an "
                "introduction here is what makes UGC read as an ad."
            ),
            max_duration_sec=4.0,
            max_sentences=1,
            requires_open_loop=True,
        ),
        BeatSpec(
            role=BeatRole.context,
            label="Problem",
            purpose=(
                "The specific, ordinary frustration — named concretely "
                "enough that the right viewer recognises their own week."
            ),
            max_sentences=2,
        ),
        BeatSpec(
            role=BeatRole.turn,
            label="The switch",
            purpose=(
                "What changed, in one sentence, without adjectives. "
                "Superlatives here are the moment the viewer decides this "
                "is paid."
            ),
            max_sentences=2,
        ),
        BeatSpec(
            role=BeatRole.reveal,
            label="Proof",
            purpose=(
                "The concrete result: a number, a timeframe, a before and "
                "after. One claim, verifiable-sounding, no stacking."
            ),
            max_sentences=2,
        ),
        BeatSpec(
            role=BeatRole.cta,
            label="Ask",
            purpose=(
                "One low-friction action, said the way a person says it, "
                "not the way a banner says it."
            ),
            max_sentences=1,
        ),
    ],
    # Fixed at five, and short ones. Lip-sync avatar models cap input
    # audio at ~30 seconds (see gotchas `avatar.audio-length-cap`), and
    # the render is rejected *after* the keyframe and the voiceover have
    # already been paid for. Five beats of ~5s is ~25s of speech, which
    # leaves headroom for a slow read.
    min_beats=5,
    max_beats=5,
)


FORMATS: list[VideoFormat] = [
    VideoFormat(
        key=explainer.KEY,
        label="Narrated explainer",
        description=(
            "Short-documentary narration where each line opens the question "
            "the next line answers. The workhorse curiosity format."
        ),
        contract=explainer.CONTRACT,
        pacing=explainer.PACING,
        voice=explainer.VOICE,
        target_duration_sec=40,
        suggested_scene_count=6,
        best_for=(
            "how something works, told through its mechanism",
            "science, medicine, and the inside of everyday objects",
            "topics where the surprising part is the process, not the fact",
        ),
        instructions=explainer.INSTRUCTIONS,
    ),
    VideoFormat(
        key="myth_buster",
        label="Myth buster",
        description=(
            "Take a belief the audience holds, concede its strongest form, "
            "then overturn it with the mechanism and rule on it."
        ),
        contract=_MYTH_BUSTER,
        # Same cadence as the explainer: it is the same documentary read,
        # aimed at a claim instead of a process.
        pacing=explainer.PACING.model_copy(update={"beat_max_sec": 6.5}),
        voice=explainer.VOICE.model_copy(
            update={
                "persona": (
                    "a fair-minded narrator who takes the myth seriously "
                    "before dismantling it — never smug"
                ),
                "words_per_minute": 170,
                "avoid": (
                    # Contempt for the belief is contempt for the viewer
                    # who held it, and that reads in the comments, not the
                    # retention graph.
                    "mockery of the audience or of the belief",
                    "greetings of any kind",
                    "hype-ad delivery or shouting",
                ),
            }
        ),
        target_duration_sec=30,
        suggested_scene_count=5,
        best_for=(
            "'everyone thinks X' topics with a real answer",
            "product or health claims that deserve a plain verdict",
            "comment-bait subjects where being fair is the differentiator",
        ),
        instructions=(
            "FORMAT: myth buster.\n\n"
            "Name the myth in the audience's own words before correcting "
            "it. Concede the strongest version of the myth at the "
            "escalation beat — an unopposed correction reads as a "
            "strawman, and the comments will supply the version you "
            "skipped. Rule explicitly at the end: 'mostly false, and "
            "here's the part that is true' beats an implied verdict, "
            "because an implied verdict gets argued with instead of "
            "shared.\n"
        ),
    ),
    VideoFormat(
        key="what_if",
        label="What if / consequence chain",
        description=(
            "A scenario followed link by link to its consequence. The "
            "escalating chain is the format; the payoff is the last link."
        ),
        contract=_WHAT_IF,
        pacing=Pacing(
            beat_min_sec=4.0,
            # Tighter ceiling than the explainer: a chain link that runs
            # long lets the viewer guess the next link, and a guessed link
            # is a skipped one.
            beat_max_sec=6.0,
            shots_per_beat=2,
            shot_min_sec=2.0,
            shot_max_sec=3.0,
            words_per_sec_min=2.5,
            words_per_sec_max=3.2,
            camera_move_cycle=("push_in", "tilt_down", "pan_right", "static"),
        ),
        voice=VoiceDirection(
            persona=(
                "a narrator delivering an escalating chain of consequences "
                "with steady, controlled dread — never gleeful"
            ),
            style_directions=(
                "Level and matter-of-fact through the chain so the facts do "
                "the work. Slow noticeably on the point of no return, then "
                "deliver the consequence flat."
            ),
            words_per_minute=175,
            speed=1.1,
            music_gain_db=-18.0,
            avoid=(
                "gore, injury detail, or shock language",
                "greetings of any kind",
                "gleeful or joking delivery",
            ),
        ),
        target_duration_sec=30,
        suggested_scene_count=5,
        best_for=(
            "'what happens when/if…' body and nature topics",
            "cause-and-effect chains with a vivid endpoint",
            "subjects where the process is more interesting than the answer",
        ),
        instructions=(
            "FORMAT: what-if consequence chain.\n\n"
            "Follow one causal chain in strict order and never skip a "
            "link — a gap is where the viewer stops believing the chain "
            "and leaves. Each beat states what happens AND what it "
            "causes, so the next beat is already owed. Keep it "
            "non-graphic: describe process and scale, not injury. Graphic "
            "wording also trips image-safety refusals at the keyframe "
            "stage, which costs a retry per scene.\n"
        ),
    ),
    VideoFormat(
        key="listicle",
        label="Listicle",
        description=(
            "A counted list where the count itself is the retention "
            "contract and the strongest item is held until last."
        ),
        contract=_LISTICLE,
        pacing=Pacing(
            # One shot per item beat: cutting inside an item implies a
            # second item and the viewer loses count, which is the one
            # thing this format cannot afford.
            beat_min_sec=3.0,
            beat_max_sec=5.0,
            shots_per_beat=1,
            shot_min_sec=3.0,
            shot_max_sec=5.0,
            words_per_sec_min=2.4,
            words_per_sec_max=3.2,
            camera_move_cycle=("push_in", "pan_right", "static", "tilt_down"),
        ),
        voice=VoiceDirection(
            persona="a knowledgeable friend running down a list, brisk and unfussy",
            style_directions=(
                "Land each item name cleanly and pause a beat before the "
                "reason — the pause is what makes an item feel like an "
                "item rather than a run-on."
            ),
            words_per_minute=170,
            speed=1.1,
            music_gain_db=-18.0,
            avoid=(
                "recapping the list at the end",
                "greetings of any kind",
                "'number one' style counting that adds words without value",
            ),
        ),
        target_duration_sec=35,
        suggested_scene_count=6,
        best_for=(
            "tips, mistakes, and 'things nobody tells you' topics",
            "niches with many small, independently useful facts",
            "series content where each item can become its own short",
        ),
        instructions=(
            "FORMAT: listicle.\n\n"
            "State the count in the hook and honour it exactly — a "
            "promised five that delivers four is the fastest way to lose "
            "a returning viewer. Every item is independent: no item may "
            "depend on the previous one, because items get clipped and "
            "reordered. Order weakest to strongest and never recap; the "
            "last item is the ending.\n"
        ),
    ),
    VideoFormat(
        key="tutorial",
        label="Tutorial",
        description=(
            "Promise an outcome, list what is needed, walk the steps in "
            "order, then show the result."
        ),
        contract=_TUTORIAL,
        pacing=Pacing(
            # One shot per step, and a slower floor than the explainer:
            # the viewer is following along, and a step they cannot
            # complete in the time it is on screen is a step they abandon.
            beat_min_sec=3.0,
            beat_max_sec=7.0,
            shots_per_beat=1,
            shot_min_sec=3.0,
            shot_max_sec=7.0,
            words_per_sec_min=2.0,
            words_per_sec_max=2.8,
            camera_move_cycle=("static", "push_in", "static", "tilt_down"),
        ),
        voice=VoiceDirection(
            persona="a patient practitioner talking through what their hands are doing",
            style_directions=(
                "Unhurried and level. Put the emphasis on the verb of each "
                "step, and leave a real pause at each step boundary so a "
                "viewer can pause the video in the right place."
            ),
            words_per_minute=150,
            # No speed lift here: a sped-up instructional read is the most
            # common reason a tutorial gets rewound instead of finished.
            speed=1.0,
            music_gain_db=-20.0,
            avoid=(
                "skipping a step because it seems obvious",
                "greetings of any kind",
                "urgency or hype delivery",
            ),
        ),
        target_duration_sec=45,
        suggested_scene_count=6,
        best_for=(
            "repeatable how-to content with a visible result",
            "software, craft, cooking, and technique niches",
            "topics that earn saves and rewatches rather than shares",
        ),
        instructions=(
            "FORMAT: tutorial.\n\n"
            "Every step is one imperative action the viewer can do while "
            "the beat is on screen. Steps run in execution order with no "
            "gaps; an assumed step is why a tutorial gets 'this didn't "
            "work' comments. State the setup before step one. End on the "
            "finished result plus one line proving it worked, then a "
            "single next action.\n"
        ),
    ),
    VideoFormat(
        key="ugc_testimonial",
        label="UGC testimonial",
        description=(
            "A first-person, to-camera recommendation: cold open, problem, "
            "switch, proof, ask. Written for lip-synced delivery."
        ),
        contract=_TESTIMONIAL,
        pacing=Pacing(
            # One shot per beat: a lip-synced beat is one continuous face
            # render, so cutting inside it means buying the same line
            # twice.
            beat_min_sec=4.0,
            beat_max_sec=6.0,
            shots_per_beat=1,
            shot_min_sec=4.0,
            shot_max_sec=6.0,
            words_per_sec_min=2.2,
            words_per_sec_max=3.0,
            # Almost no camera movement: handheld stillness is what makes
            # UGC read as a person rather than a production.
            camera_move_cycle=("static", "static", "push_in", "static"),
        ),
        voice=VoiceDirection(
            persona="a real customer telling a friend about something that worked",
            style_directions=(
                "Conversational, slightly uneven, a little fast at the "
                "start of sentences. Warmth over polish; a perfectly even "
                "read is what makes a testimonial sound bought."
            ),
            words_per_minute=160,
            speed=1.0,
            music_gain_db=-24.0,
            avoid=(
                "superlatives and advertising adjectives",
                "greetings or introductions",
                "reading a feature list",
            ),
        ),
        target_duration_sec=25,
        suggested_scene_count=5,
        best_for=(
            "product recommendations and app walkthroughs",
            "paid social creative that must not look like paid social",
            "avatar or lip-synced delivery with a single presenter",
        ),
        instructions=(
            "FORMAT: UGC testimonial.\n\n"
            "First person throughout, past tense for the problem, present "
            "for the result. One claim only, and make it specific enough "
            "to sound checkable. No greeting, no sign-off, no feature "
            "list.\n"
            "Keep total narration under about seventy-five words: "
            "lip-sync models cap input audio at roughly thirty seconds "
            "and reject the render after the keyframe and the voiceover "
            "have already been paid for.\n"
            "Keyframes must be a clean single-person portrait, face "
            "unobstructed and roughly front-facing, or the avatar model "
            "returns no lip movement at all.\n"
        ),
    ),
]

_BY_KEY: dict[str, VideoFormat] = {f.key: f for f in FORMATS}

DEFAULT_FORMAT_KEY = explainer.KEY
FORMAT_KEYS: tuple[str, ...] = tuple(f.key for f in FORMATS)


def get_format(key: str) -> VideoFormat | None:
    return _BY_KEY.get(key)


def resolve(key: str | None) -> VideoFormat:
    """The format for `key`, or the default when `key` is empty.

    Raises `UnknownFormatKey` for a non-empty key that isn't in the
    catalog, so a typo fails at the edge instead of quietly rendering a
    different (paid-for) video.
    """
    if not key:
        return _BY_KEY[DEFAULT_FORMAT_KEY]
    fmt = _BY_KEY.get(key)
    if fmt is None:
        raise UnknownFormatKey(f"unknown video format: {key}")
    return fmt


# ---------------------------------------------------------------------------
# Prompt assembly


def _beat_lines(fmt: VideoFormat) -> list[str]:
    lines: list[str] = []
    for i, spec in enumerate(fmt.contract.specs, start=1):
        if spec.max_count is None:
            count = f"{spec.min_count} or more"
        elif spec.max_count == spec.min_count:
            count = f"exactly {spec.min_count}"
        else:
            count = f"{spec.min_count}-{spec.max_count}"
        line = f"{i}. {spec.label} ({count}): {spec.purpose}"
        extra: list[str] = []
        if spec.max_duration_sec is not None:
            extra.append(f"at most {spec.max_duration_sec:g}s")
        if spec.max_sentences is not None:
            extra.append(f"at most {spec.max_sentences} sentence(s)")
        if spec.requires_open_loop:
            extra.append("must leave a question open")
        if spec.requires_question:
            extra.append("must contain a literal question mark")
        if extra:
            line += f" [{'; '.join(extra)}]"
        lines.append(line)
    return lines


def scriptwriter_directives(fmt: VideoFormat, *, tts_model: str = "*") -> str:
    """The format block to inject into the scriptwriter prompt.

    Deterministic string assembly over the same objects `check_script`
    grades against, so the writer is told exactly the rules it will be
    scored on. Anything the writer is graded on but never told is just a
    retry the user paid for.

    The narration constraints come from the gotchas KB rather than being
    restated here: they are model failure modes, they change when models
    change, and there must be one copy of them.
    """
    p = fmt.pacing
    parts: list[str] = []
    if fmt.instructions:
        parts.append(fmt.instructions.strip())
    parts.append(
        "BEAT CONTRACT (in order — the script is graded against this):\n"
        + "\n".join(_beat_lines(fmt))
        + f"\nTotal beats: {fmt.contract.min_beats}-{fmt.contract.max_beats}."
    )
    parts.append(
        "PACING MATH (non-negotiable — the narration becomes real speech):\n"
        f"- Each beat runs {p.beat_min_sec:g}-{p.beat_max_sec:g} seconds.\n"
        f"- Narration is {p.words_per_sec_min:g}x to {p.words_per_sec_max:g}x "
        "duration_sec in words. Count them.\n"
        f"- Total runtime targets {fmt.target_duration_sec}s.\n"
        f"- Each beat is cut into {p.shots_per_beat} shot(s) of "
        f"{p.shot_min_sec:g}-{p.shot_max_sec:g}s."
    )
    voice_lines = [
        f"VOICE: {fmt.voice.persona}.",
        fmt.voice.style_directions,
        f"Target delivery {fmt.voice.words_per_minute} words per minute.",
    ]
    if fmt.voice.avoid:
        voice_lines.append("Never: " + "; ".join(fmt.voice.avoid) + ".")
    parts.append("\n".join(voice_lines))
    narration_rules = gotchas.rules_block(tts_model, stage="tts")
    if narration_rules:
        parts.append(narration_rules)
    return "\n\n".join(parts)


def check(script: Script, fmt: VideoFormat) -> dict:
    """Grade a script against a format: `{issues, passed, metrics}`."""
    return score_beats(script, contract=fmt.contract, pacing=fmt.pacing)


# ---------------------------------------------------------------------------
# Wire shapes


class FormatSummary(BaseModel):
    """Catalog row: enough to pick a format, not enough to write one."""

    key: str
    label: str
    description: str
    structure: str
    target_duration_sec: int
    suggested_scene_count: int
    best_for: list[str] = Field(default_factory=list)
    min_beats: int
    max_beats: int


class FormatDetail(FormatSummary):
    """One format in full: the beat contract, pacing, and voice direction."""

    beats: BeatContractSummary
    contract: BeatContract
    pacing: Pacing
    voice: VoiceDirection
    instructions: str
    # The exact text the scriptwriter is given — inspectable before spend.
    scriptwriter_directives: str


def summary(fmt: VideoFormat) -> FormatSummary:
    return FormatSummary(
        key=fmt.key,
        label=fmt.label,
        description=fmt.description,
        structure=fmt.contract.summary(),
        target_duration_sec=fmt.target_duration_sec,
        suggested_scene_count=fmt.suggested_scene_count,
        best_for=list(fmt.best_for),
        min_beats=fmt.contract.min_beats,
        max_beats=fmt.contract.max_beats,
    )


def summaries() -> list[FormatSummary]:
    return [summary(f) for f in FORMATS]


def detail(fmt: VideoFormat) -> FormatDetail:
    return FormatDetail(
        **summary(fmt).model_dump(),
        beats=contract_summary(fmt.contract),
        contract=fmt.contract,
        pacing=fmt.pacing,
        voice=fmt.voice,
        instructions=fmt.instructions,
        scriptwriter_directives=scriptwriter_directives(fmt),
    )


# ---------------------------------------------------------------------------
# Import-time validation
#
# Every one of these would otherwise surface as a wrong (already paid
# for) video or a 500 the first time a user picked the format. Here it
# breaks CI instead — the same trick `cinema.presets` uses.

_SLUG = re.compile(r"[a-z0-9_]+")
# `beats.check_script` only accepts these as the final beat; anything
# else means the open loop is never closed and EVERY script in that
# format would be graded as failing.
_CLOSING_ROLES = (BeatRole.button, BeatRole.reveal, BeatRole.cta)


def _validate_format(fmt: VideoFormat) -> None:
    if not _SLUG.fullmatch(fmt.key):
        raise ValueError(f"format key must be a slug: {fmt.key!r}")

    specs = fmt.contract.specs
    if not specs:
        raise ValueError(f"{fmt.key}: contract has no beats")

    # `check_script` indexes specs by role (`{s.role: s for s in specs}`),
    # so two slots sharing a role would silently drop one slot's rules.
    roles = [s.role for s in specs]
    if len(roles) != len(set(roles)):
        raise ValueError(f"{fmt.key}: beat roles must be unique within a contract")

    if specs[-1].role not in _CLOSING_ROLES:
        raise ValueError(
            f"{fmt.key}: last beat is {specs[-1].role.value}; must close the "
            f"loop ({', '.join(r.value for r in _CLOSING_ROLES)})"
        )

    flexible = [s for s in specs if s.max_count is None]
    if len(flexible) > 1:
        raise ValueError(f"{fmt.key}: more than one flexible beat slot is ambiguous")

    total_min = fmt.contract.total_min()
    if fmt.contract.min_beats < total_min:
        raise ValueError(
            f"{fmt.key}: min_beats {fmt.contract.min_beats} < {total_min} required slots"
        )
    if fmt.contract.max_beats < fmt.contract.min_beats:
        raise ValueError(f"{fmt.key}: max_beats < min_beats")

    # Every count in the declared range must actually be assignable, or a
    # script with that many scenes fails grading for a reason no writer
    # can fix.
    for n in range(fmt.contract.min_beats, fmt.contract.max_beats + 1):
        if not assign_roles(n, fmt.contract):
            raise ValueError(f"{fmt.key}: {n} beats cannot be mapped onto the contract")

    p = fmt.pacing
    # A beat has to be long enough to hold its shots at their minimum
    # length; otherwise plan_shots clamps and the beat overruns its own
    # duration, drifting narration out of sync with the cuts.
    if p.beat_min_sec < p.shots_per_beat * p.shot_min_sec:
        raise ValueError(
            f"{fmt.key}: beat_min_sec {p.beat_min_sec} cannot hold "
            f"{p.shots_per_beat} shots of {p.shot_min_sec}s"
        )
    if p.beat_min_sec > p.beat_max_sec or p.words_per_sec_min > p.words_per_sec_max:
        raise ValueError(f"{fmt.key}: inverted pacing envelope")

    # A per-beat duration cap below the format's own floor makes the
    # contract unsatisfiable: check_script would flag the beat for being
    # too long AND for being under the pacing floor, whatever the writer
    # does. (This guard exists because the first draft of the explainer
    # capped the hook at 3s inside a 4s-floor format — every script it
    # could ever produce would have failed grading.)
    for spec in specs:
        if spec.max_duration_sec is not None and spec.max_duration_sec < p.beat_min_sec:
            raise ValueError(
                f"{fmt.key}: {spec.label} caps at {spec.max_duration_sec}s but the "
                f"format's shortest legal beat is {p.beat_min_sec}s"
            )

    # The target duration must be reachable with a legal number of legal
    # beats — a format that cannot hit its own target produces a script
    # that fails the duration eval no matter how well it is written.
    shortest = fmt.contract.min_beats * p.beat_min_sec
    longest = fmt.contract.max_beats * p.beat_max_sec
    if not shortest <= fmt.target_duration_sec <= longest:
        raise ValueError(
            f"{fmt.key}: target {fmt.target_duration_sec}s outside the "
            f"achievable {shortest:g}-{longest:g}s"
        )
    if not fmt.contract.min_beats <= fmt.suggested_scene_count <= fmt.contract.max_beats:
        raise ValueError(f"{fmt.key}: suggested_scene_count outside the beat range")

    # Voice and pacing are one decision: a wpm outside the format's own
    # words-per-second window means the writer and the voice are being
    # told different tempos, and the render lands long or short.
    wps = fmt.voice.words_per_minute / 60.0
    if not p.words_per_sec_min <= wps <= p.words_per_sec_max:
        raise ValueError(
            f"{fmt.key}: voice {fmt.voice.words_per_minute} wpm ({wps:.2f} w/s) "
            f"outside pacing {p.words_per_sec_min}-{p.words_per_sec_max} w/s"
        )


def _validate_registry() -> None:
    if len(FORMAT_KEYS) != len(set(FORMAT_KEYS)):
        raise ValueError("duplicate format keys")
    if DEFAULT_FORMAT_KEY not in _BY_KEY:
        raise ValueError(f"default format {DEFAULT_FORMAT_KEY} is not in the catalog")
    for fmt in FORMATS:
        _validate_format(fmt)


_validate_registry()
