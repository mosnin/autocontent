"""The narrated-documentary explainer: its beat contract, prompt, and voice.

This is the format the whole package was built for — a fast, narrated,
curiosity-driven short where every line opens the question the next line
answers. It lives in its own module (rather than as one more entry in
`registry`) because it carries the most craft: a scriptwriter prompt, a
voice performance, and a beat contract that the other formats are
variations on.

Pure data + pure functions. Nothing here does I/O, so the pipeline can
import it on the hot path and evals can grade against it for free.

Every rule below carries the failure it prevents. That rationale is the
point: a rule without its reason gets "simplified" away by the next
person who reads it.
"""
from __future__ import annotations

from .beats import BeatContract, BeatRole, BeatSpec, Pacing, VoiceDirection

KEY = "explainer"

# The five-beat curiosity loop.
#
# Hook opens a gap, mechanism explains why the answer is not obvious,
# escalation raises the stakes one concrete step at a time, the turn
# re-earns attention at the midpoint, and the payoff closes the loop the
# hook opened. Drop any one of them and a specific failure appears:
#   - no mechanism  -> the video is a claim, and claims get argued with
#                      in the comments instead of watched to the end;
#   - no escalation -> the middle is flat and the viewer leaves at ~40%;
#   - no turn       -> attention decays monotonically after the hook;
#   - no payoff     -> "so what?" comments, no rewatch, no share.
CONTRACT = BeatContract(
    specs=[
        BeatSpec(
            role=BeatRole.hook,
            label="Hook",
            purpose=(
                "State the surprising claim or question in one sentence and "
                "leave it unanswered. Name the subject concretely — a hook "
                "about 'your body' stops nobody; a hook about 'the gum you "
                "swallowed' stops everybody."
            ),
            # The hook is the SHORTEST legal beat of the format. The
            # 3-second audition is enforced in *words*, not seconds
            # (`HOOK_MAX_WORDS`), because this number is the length of
            # the shot, not of the spoken line — and a beat shorter than
            # `PACING.beat_min_sec` cannot hold its two shots at all.
            max_duration_sec=4.0,
            # Two sentences in a hook means the viewer has to hold the
            # first one while parsing the second; they swipe instead.
            max_sentences=1,
            requires_open_loop=True,
        ),
        BeatSpec(
            role=BeatRole.context,
            label="Mechanism",
            purpose=(
                "Name the specific process that makes the answer "
                "non-obvious. One mechanism, one sentence, concrete nouns "
                "— this is the beat that converts a claim into an "
                "explanation the viewer trusts."
            ),
            max_sentences=2,
        ),
        BeatSpec(
            role=BeatRole.escalation,
            label="Escalation",
            purpose=(
                "Advance the process by exactly one step, and make that "
                "step more specific or more surprising than the one before "
                "it. Never restate the previous beat in new words."
            ),
            # The only flexible slot: everything between the mechanism and
            # the turn is escalation, so a 5-beat and an 8-beat explainer
            # share one contract instead of needing two.
            max_count=None,
            max_sentences=2,
        ),
        BeatSpec(
            role=BeatRole.turn,
            label="Turn",
            purpose=(
                "Contradict the expectation the escalation just built, and "
                "ask the question that the payoff answers ('so what happens "
                "next?')."
            ),
            # The literal question mark is the pattern reset. Retention
            # curves dip hardest around the midpoint; an explicit question
            # is the cheapest known way to re-earn the next ten seconds.
            requires_question=True,
            max_sentences=2,
        ),
        BeatSpec(
            role=BeatRole.reveal,
            label="Payoff",
            purpose=(
                "Answer the hook, in plain words, with the concrete detail "
                "that makes it memorable (a number, a duration, an image). "
                "No summary, no 'and that's how' — the answer is the ending."
            ),
            max_sentences=2,
        ),
    ],
    min_beats=5,
    # Past ~8 beats a 30-45s short either sprints past the payoff or runs
    # long enough that completion rate (not hook rate) becomes the binding
    # constraint. 8 is the last count that still lands inside 45 seconds.
    max_beats=8,
)

# Cut cadence.
#
# Two shots per beat is the single change that turns narration-over-images
# into something that reads as directed: shot A establishes what we are
# looking at, shot B goes *inside* it. One held shot per beat reads as a
# slideshow, and AI keyframes hold especially badly because nothing in
# them moves.
PACING = Pacing(
    # Two shots of at least 2s each means a beat cannot be shorter than 4s
    # without one of its shots being too short to register.
    beat_min_sec=4.0,
    # 7s is the platform-wide scene ceiling the generic evals also enforce
    # (`evals.script_checks.SCENE_MAX_SEC`); a beat longer than that has
    # stopped being a beat.
    beat_max_sec=7.0,
    shots_per_beat=2,
    shot_min_sec=2.0,
    shot_max_sec=4.0,
    # 145-180 wpm in words-per-second. Narrower than the generic eval band
    # because the documentary read is a specific tempo: slower sounds like
    # a lecture, faster outruns the cuts.
    words_per_sec_min=2.4,
    words_per_sec_max=3.0,
    # Push in, pan, tilt, then lock off on the impact beat. Repeating one
    # move for a whole video is the tell of an auto-generated video;
    # rotating costs nothing and reads as coverage.
    camera_move_cycle=("push_in", "pan_right", "tilt_down", "static"),
)

VOICE = VoiceDirection(
    persona=(
        "a calm documentary narrator who finds the subject genuinely "
        "fascinating — informed, never breathless, never salesy"
    ),
    style_directions=(
        "Even, articulate delivery at a brisk clip. Land the last word of "
        "each beat cleanly so the cut has something to cut on. Lift very "
        "slightly on the turn, drop and slow on the payoff."
    ),
    # 165 wpm = 2.75 words/sec, the centre of the pacing band above.
    words_per_minute=165,
    # A small playback lift is what makes explainer narration feel urgent
    # rather than read aloud; past ~1.15 consonants start to smear.
    speed=1.1,
    # Bed audible, consonants untouched.
    music_gain_db=-18.0,
    avoid=(
        # Every one of these is a documented retention leak in the first
        # three seconds: greetings and meta-narration spend the hook on
        # nothing, and hype-ad delivery tells the viewer this is an ad.
        "greetings of any kind",
        "meta-narration ('in this video', 'let's talk about')",
        "hype-ad delivery or shouting",
        "rhetorical filler ('the truth is', 'believe it or not')",
    ),
)

# The scriptwriter prompt block for this format.
#
# Phrased as instructions to a writer, not as description, because it is
# injected verbatim into the scriptwriter agent's prompt. Rules that
# repeat what the beat contract already says are omitted — the contract
# is rendered into the prompt separately by
# `registry.scriptwriter_directives`, and a rule stated twice in one
# prompt is a rule the model averages instead of following.
INSTRUCTIONS = """FORMAT: narrated explainer (short documentary).

Write in curiosity loops. Every beat must leave one specific question
open that the NEXT beat answers, and the final beat answers the hook.
A beat that answers its own question ends the video early.

Narration:
- Second person, present tense, concrete nouns. "Your stomach", not
  "the digestive system".
- One idea per beat. Two ideas in a beat means the viewer loses the
  thread at the second one.
- Spoken words only. Delivery notes, stage directions, speaker labels
  and bracketed asides get read aloud verbatim by the voice model.
- Write numbers, units and ranges the way they are said out loud
  ("about three centimetres", "twenty nineteen to twenty twenty one").
  Symbols and abbreviations are pronounced literally by the voice model.
- No em or en dashes. They synthesize as a dead pause and kill the
  momentum the format runs on. Use a comma or a new sentence.

Visuals (visual_prompt):
- Open every scene with the identical style prefix, then the scene
  content. Style words placed late get diluted by scene detail and the
  video drifts from illustration to photograph halfway through.
- Alternate: an establishing frame of the subject, then a detail or
  cutaway that goes inside it. The cutaway is what makes the format feel
  like a documentary instead of a slideshow.
- Never ask for text, words, numbers, labels, signs or UI in a frame.
  Image models garble glyphs; captions are burned in later where they
  are perfectly legible.
- Restate the cast's identity clause (hair, wardrobe, build) in EVERY
  scene that shows the cast. Each keyframe is sampled independently, so
  "the same character as before" carries no identity information.
- For anatomy or medical interiors, frame it as a clean educational
  model: stylized cross-section, smooth matte surfaces, non-graphic. The
  words 'realistic', 'blood', 'wound' and 'surgery' trip image-safety
  refusals and cost a retry.

Motion (motion_prompt):
- Motion only, under 20 words, ONE camera move or ONE subject motion.
  The keyframe already fixed the content; a motion prompt that
  introduces new content makes the clip morph.
- Never write dialogue, speech or sound effects into a motion prompt.
  Video models with native audio will generate speech and lip movement
  that desync against our own voiceover.
"""


def contract() -> BeatContract:
    """The explainer beat contract (returned, not exported mutable)."""
    return CONTRACT.model_copy(deep=True)
