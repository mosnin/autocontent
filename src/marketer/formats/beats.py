"""The beat layer: the narrative contract a script must satisfy for its format.

A "beat" is one unit of narrative work (open the loop, escalate, turn,
pay off). A *format* declares an ordered contract of beats; a generated
:class:`~marketer.models.Script` satisfies that contract or it doesn't.
Scenes map onto beats positionally — scene 0 is the hook, the last scene
is the button — because that is how the viewer experiences them.

Everything here is pure data + pure functions: no I/O, no network, no DB.
That is deliberate. The pipeline imports this on the hot path to steer the
scriptwriter and to grade its output, and CI/evals import it to score
scripts offline for free.

Craft rules encoded here come from short-documentary practice; each one
carries a comment saying which failure it prevents, because the rule is
worth more than the number.
"""
from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field

from ..models import Script

# A hook that takes longer than ~3 seconds to land has already lost the
# scroll. At documentary narration pace that is roughly 12 words — the
# same bound the generic script evals use, imported rather than
# re-declared so the two graders can never disagree.
from ..evals.script_checks import HOOK_MAX_WORDS

# Phrases that mark an *open loop*: a sentence that creates a question the
# viewer needs closed. A hook without one is a statement, and statements
# do not survive the swipe. Kept broad on purpose — this is a smell test,
# not a grammar check.
OPEN_LOOP_MARKERS: tuple[str, ...] = (
    "but",
    "until",
    "actually",
    "turns out",
    "nobody",
    "no one",
    "what happens",
    "why",
    "how",
    "here's",
    "heres",
    "never",
    "secretly",
    "really",
)


class BeatRole(str, Enum):
    """What a beat is *for*. Roles, not scene numbers, carry the craft."""

    hook = "hook"
    context = "context"
    escalation = "escalation"
    turn = "turn"
    reveal = "reveal"
    button = "button"
    item = "item"
    cta = "cta"


class BeatSpec(BaseModel):
    """One slot in a format's beat contract."""

    role: BeatRole
    label: str
    # Goes verbatim into the scriptwriter prompt — this is the instruction
    # the writer actually follows, so it must be an action, not a noun.
    purpose: str
    min_count: int = 1
    # None = "absorbs whatever scenes are left after the fixed slots".
    # Exactly one flexible slot per contract keeps assignment unambiguous.
    max_count: int | None = 1
    max_duration_sec: float | None = None
    # More than one or two sentences in a beat means the beat is carrying
    # more than one idea; the viewer drops the thread at the second idea.
    max_sentences: int | None = None
    requires_open_loop: bool = False
    requires_question: bool = False


class BeatContract(BaseModel):
    """The ordered beat structure of a format, plus its size envelope."""

    specs: list[BeatSpec]
    min_beats: int
    max_beats: int

    def summary(self) -> str:
        """One-line shape for the catalog UI: 'Hook -> Mechanism -> ...'."""
        return " -> ".join(s.label for s in self.specs)

    def total_min(self) -> int:
        return sum(s.min_count for s in self.specs)


class Pacing(BaseModel):
    """Cut cadence and speech-rate envelope for a format.

    Shot cadence is the single biggest retention lever in a narrated
    short: a held shot reads as a slideshow, and AI keyframes hold *very*
    badly because nothing moves in them. Two shots per beat (a wide
    establishing frame, then a detail/cutaway that goes *inside* the
    subject) is what turns narration into cinema.
    """

    beat_min_sec: float = 2.0
    beat_max_sec: float = 7.0
    shots_per_beat: int = 1
    shot_min_sec: float = 2.0
    shot_max_sec: float = 4.0
    # Spoken VO envelope. Narration is measured against this, not against
    # a word count, because the words become real speech of real length.
    words_per_sec_min: float = 2.0
    words_per_sec_max: float = 3.2
    # Camera moves are cycled across consecutive beats. Repeating one move
    # for a whole video is the tell of an auto-generated video; varying it
    # costs nothing and reads as direction.
    camera_move_cycle: tuple[str, ...] = ("push_in", "pan_right", "tilt_down", "static")


class VoiceDirection(BaseModel):
    """How the narration should be *performed* for this format.

    Lives beside pacing rather than in the TTS layer because delivery and
    cut cadence are one craft decision: a documentary read at 165 wpm over
    3-second cuts is the format; the same words read slowly are a
    different video.
    """

    persona: str
    # Feeds a niche's `tts_style_directions` when the niche has none.
    style_directions: str
    words_per_minute: int = 165
    # Playback rate multiplier applied to synthesized narration. Slightly
    # above 1.0 is what makes explainer VO feel urgent instead of read.
    speed: float = 1.0
    # Music sits this far under narration. -18 dB is the level at which a
    # bed is audible but never competes with consonants.
    music_gain_db: float = -18.0
    avoid: tuple[str, ...] = ()


class ShotPlan(BaseModel):
    """One rendered shot inside a beat."""

    beat_index: int
    shot_index: int
    kind: str  # "establishing" | "detail"
    duration_sec: float
    camera_move: str


def plan_shots(beat_index: int, duration_sec: float, pacing: Pacing) -> list[ShotPlan]:
    """Split one beat into its shots, with a camera move per shot.

    Why split at all: a single 6-second AI clip drifts and loops; two
    3-second clips of the same beat cut together read as coverage. The
    move rotates by beat so consecutive beats never share a move.
    """
    count = max(1, pacing.shots_per_beat)
    per = duration_sec / count
    # Clamp to the cadence envelope; if the beat is too long for its shot
    # count, the caller has already been told by check_script.
    per = max(pacing.shot_min_sec, min(pacing.shot_max_sec, per))
    cycle = pacing.camera_move_cycle or ("static",)
    shots: list[ShotPlan] = []
    for i in range(count):
        shots.append(
            ShotPlan(
                beat_index=beat_index,
                shot_index=i,
                # Shot A establishes what we are looking at; shot B goes
                # inside it. Without the cutaway the video is a slideshow
                # of posters.
                kind="establishing" if i == 0 else "detail",
                duration_sec=round(per, 2),
                camera_move=cycle[(beat_index + i) % len(cycle)],
            )
        )
    return shots


def assign_roles(scene_count: int, contract: BeatContract) -> list[BeatRole]:
    """Map `scene_count` scenes onto the contract's roles, in order.

    Returns [] when the count cannot satisfy the contract (too few scenes
    for the fixed slots, or too many for the flexible one) — callers turn
    that into a human-readable issue.
    """
    counts = [s.min_count for s in contract.specs]
    slack = scene_count - sum(counts)
    if slack < 0:
        return []
    for i, spec in enumerate(contract.specs):
        if slack <= 0:
            break
        if spec.max_count is None:
            counts[i] += slack
            slack = 0
        else:
            take = min(spec.max_count - spec.min_count, slack)
            counts[i] += take
            slack -= take
    if slack > 0:
        return []
    roles: list[BeatRole] = []
    for spec, n in zip(contract.specs, counts):
        roles.extend([spec.role] * n)
    return roles


def _words(text: str) -> int:
    return len(text.split())


def _sentences(text: str) -> int:
    return len([p for p in text.replace("!", ".").replace("?", ".").split(".") if p.strip()])


def _opens_loop(text: str) -> bool:
    lowered = text.lower()
    return "?" in text or any(m in lowered for m in OPEN_LOOP_MARKERS)


def check_script(script: Script, *, contract: BeatContract, pacing: Pacing) -> list[str]:
    """Grade a script against its format's beat contract.

    Returns human-readable issue strings; empty means the script honors
    the format. Deterministic and offline — same contract as
    `evals.script_checks`, so both can gate CI and grade live runs.
    """
    issues: list[str] = []
    scenes = script.scenes
    n = len(scenes)

    if not contract.min_beats <= n <= contract.max_beats:
        issues.append(
            f"format wants {contract.min_beats}-{contract.max_beats} beats, script has {n}"
        )

    roles = assign_roles(n, contract)
    if not roles:
        issues.append(
            f"{n} scenes cannot be mapped onto beat structure "
            f"{contract.summary()!r} (needs at least {contract.total_min()})"
        )
        return issues

    by_role = {s.role: s for s in contract.specs}
    for scene, role in zip(scenes, roles):
        spec = by_role[role]
        text = scene.narration.strip()

        if spec.max_duration_sec is not None and scene.duration_sec > spec.max_duration_sec:
            issues.append(
                f"scene {scene.index} ({spec.label}): {scene.duration_sec}s exceeds "
                f"{spec.max_duration_sec}s — this beat loses the viewer if it lingers"
            )
        if spec.max_sentences is not None and _sentences(text) > spec.max_sentences:
            issues.append(
                f"scene {scene.index} ({spec.label}): {_sentences(text)} sentences "
                f"(max {spec.max_sentences}) — one beat carries one idea"
            )
        if spec.requires_open_loop and not _opens_loop(text):
            issues.append(
                f"scene {scene.index} ({spec.label}): narration closes instead of "
                f"opening a loop — no question the viewer needs answered: {text!r}"
            )
        if spec.requires_question and "?" not in text:
            issues.append(
                f"scene {scene.index} ({spec.label}): needs an explicit question mark "
                f"to re-earn attention: {text!r}"
            )
        if role is BeatRole.hook and _words(text) > HOOK_MAX_WORDS:
            issues.append(
                f"scene {scene.index} (hook): {_words(text)} words "
                f"(max {HOOK_MAX_WORDS}) — the hook must land inside 3 seconds"
            )
        if not pacing.beat_min_sec <= scene.duration_sec <= pacing.beat_max_sec:
            issues.append(
                f"scene {scene.index}: {scene.duration_sec}s outside this format's "
                f"{pacing.beat_min_sec}-{pacing.beat_max_sec}s beat window"
            )
        if scene.duration_sec > 0:
            wps = _words(text) / scene.duration_sec
            if not pacing.words_per_sec_min <= wps <= pacing.words_per_sec_max:
                issues.append(
                    f"scene {scene.index}: {wps:.2f} words/sec outside this format's "
                    f"{pacing.words_per_sec_min}-{pacing.words_per_sec_max} narration pace"
                )

    # The last beat is the button: it closes the loop the hook opened. A
    # script that ends on an escalation leaves the viewer unpaid, which is
    # what produces "so what?" comments and no rewatch.
    if roles and roles[-1] not in (BeatRole.button, BeatRole.reveal, BeatRole.cta):
        issues.append(
            f"script ends on a {roles[-1].value} beat — the open loop is never closed"
        )
    return issues


def score_beats(script: Script, *, contract: BeatContract, pacing: Pacing) -> dict:
    """Aggregate the beat check into ``{"issues", "passed", "metrics"}``.

    Same envelope as `evals.script_checks.score_script` so both graders can
    be merged into one report by callers.
    """
    issues = check_script(script, contract=contract, pacing=pacing)
    roles = assign_roles(len(script.scenes), contract)
    total = sum(s.duration_sec for s in script.scenes)
    words = sum(_words(s.narration) for s in script.scenes)
    return {
        "issues": issues,
        "passed": not issues,
        "metrics": {
            "beat_count": len(script.scenes),
            "roles": [r.value for r in roles],
            "total_duration_sec": total,
            "avg_words_per_sec": (words / total) if total > 0 else 0.0,
            "shot_count": sum(
                len(plan_shots(i, s.duration_sec, pacing)) for i, s in enumerate(script.scenes)
            ),
            "issue_count": len(issues),
        },
    }


class BeatContractSummary(BaseModel):
    """Wire shape for the catalog UI (no prompts, no validation guts)."""

    structure: str
    beats: list[str] = Field(default_factory=list)
    min_beats: int
    max_beats: int


def contract_summary(contract: BeatContract) -> BeatContractSummary:
    return BeatContractSummary(
        structure=contract.summary(),
        beats=[f"{s.label}: {s.purpose}" for s in contract.specs],
        min_beats=contract.min_beats,
        max_beats=contract.max_beats,
    )
