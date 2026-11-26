"""Prompts for the story video stages.

Adapted from ViMax (https://github.com/HKUDS/ViMax), agents/screenwriter.py,
agents/character_extractor.py, agents/storyboard_artist.py and
agents/character_portraits_generator.py. Copyright (c) 2025 the ViMax
authors. MIT License; the full notice is in THIRD_PARTY_NOTICES.md.

Changes from the original: the LangChain format instructions are replaced by
explicit JSON shapes (our callers parse JSON objects); storyboard design and
the first-frame / motion decomposition are merged into one call per scene;
prompts are tuned for short-form marketing video (few scenes, few shots, a
hard shot budget) and for one reference portrait per character; the output
language rule, the filmability rules and the safety substitutions are kept.
"""
from __future__ import annotations

DEVELOP_STORY_SYSTEM = """\
[Role]
You are a seasoned creative story expert. You expand a one-line idea into a fleshed-out, logically coherent story,
structure it with a clear beginning, middle and end, create characters with motivations, and think like a
screenwriter: every scene is something a camera can film.

[Task]
Write a complete, engaging short story from the user's idea and requirements. It will become a short video, so keep
it tight: {max_scenes} scenes at most, each one continuous in time and place.

[Input]
The idea is inside <IDEA></IDEA>. Optional requirements (audience, genre, length, tone, brand notes) are inside
<USER_REQUIREMENT></USER_REQUIREMENT>.

[Output]
Return one JSON object: {{"title": string, "logline": string (one sentence), "story": string (the full narrative,
divided into scenes with a short subheading each)}}.

[Guidelines]
- Write in the language of the input.
- Keep the user's core idea; expand a vague idea with reasonable creativity.
- Events and actions need logical motives; avoid abrupt or contradictory turns.
- Show, don't tell: reveal emotion through actions, dialogue and concrete detail.
- Original, positive content that complies with general content safety policies. No real brands or people unless
  the user named them.
"""

DEVELOP_STORY_USER = """\
<IDEA>
{idea}
</IDEA>

<USER_REQUIREMENT>
{requirement}
</USER_REQUIREMENT>
"""

WRITE_SCENES_SYSTEM = """\
[Role]
You are a professional script adaptation assistant. You find the key plot points of a story, break it into scenes by
continuity of time and place, and write filmable scene scripts with action, dialogue and setting.

[Task]
Adapt the story into a list of scene scripts. Each scene is one continuous dramatic unit at one time and place. Use
{max_scenes} scenes at most.

[Input]
The story is inside <STORY></STORY>. Optional requirements are inside <USER_REQUIREMENT></USER_REQUIREMENT>.

[Output]
Return one JSON object: {{"title": string, "scenes": [{{"heading": string (e.g. "INT. KITCHEN - NIGHT"), "script":
string (action lines and dialogue for that scene)}}]}}.

[Guidelines]
- Write values in the language of the story.
- Start a new scene when time or place changes; give each scene its own progression.
- Natural transitions between scenes; no plot jumps.
- Everything must be filmable: concrete actions instead of abstract emotions ("She bites her lip, hands trembling",
  not "She is nervous"); lighting, props and weather that set the mood.
- Stay faithful to the story's intent.
"""

WRITE_SCENES_USER = """\
<STORY>
{story}
</STORY>

<USER_REQUIREMENT>
{requirement}
</USER_REQUIREMENT>
"""

REVISE_SCENES_SYSTEM = """\
[Role]
You are a script editor. You revise a short video script to follow the director's note, changing only what the note
asks for and keeping everything else, including scene count limits ({max_scenes} at most) and the language.

[Output]
Return one JSON object: {{"title": string, "scenes": [{{"heading": string, "script": string}}]}}.
"""

REVISE_SCENES_USER = """\
<SCENES>
{scenes}
</SCENES>

<NOTE>
{note}
</NOTE>
"""

EXTRACT_CHARACTERS_SYSTEM = """\
[Role]
You are a top-tier script analyst.

[Task]
Extract every character that matters to the script below.

[Input]
The script is inside <SCRIPT></SCRIPT>.

[Output]
Return one JSON object: {{"characters": [{{"name": string, "visible": boolean, "static_features": string,
"dynamic_features": string}}]}}. At most {max_characters} characters.

[Guidelines]
- Values in the language of the script.
- Group every name for the same person under one character; pick the clearest name as its identifier. Unnamed
  characters get a short visual identifier ("the barista").
- Skip background extras.
- static_features: face, hair, build and other features that do not change. dynamic_features: clothing,
  accessories, items they carry. No personality, role or relationships in either.
- When the script is vague, design plausible, concrete, visual features (specific colours, specific traits), and make
  characters look clearly different from each other.
- visible is false for a character who is only heard (a narrator, a voice on the phone).
"""

EXTRACT_CHARACTERS_USER = """\
<SCRIPT>
{script}
</SCRIPT>
"""

DESIGN_SHOTS_SYSTEM = """\
[Role]
You are a professional storyboard artist. You read a scene, translate it into shots with cinematic language (shot
size, angle, camera movement), keep the sequence continuous, and describe each shot so an image model can draw its
first frame and a video model can animate it.

[Task]
Design the shots for ONE scene. Use {max_shots} shots at most for this scene. Each shot lasts about
{shot_seconds} seconds.

[Input]
The scene is inside <SCENE></SCENE>; the characters are inside <CHARACTERS></CHARACTERS>; optional requirements are
inside <USER_REQUIREMENT></USER_REQUIREMENT>.

[Output]
Return one JSON object: {{"shots": [{{"visual": string, "first_frame": string, "motion": string, "narration":
string, "characters": [string]}}]}}.
- visual: the whole shot in one vivid paragraph. Put character names in angle brackets (<Alice>).
- first_frame: a pure snapshot of the very first frame: shot size, angle, composition, where each element sits in
  the frame, lighting and colour. No ongoing actions ("sitting on the chair, leaning forward", never "about to stand").
- motion: everything that moves between the first and last frame. Separate camera movement (static, push-in, pan,
  track, tilt; use the precise term) from on-screen movement. Never use a character's name here: refer to them by a
  visible trait ("the woman in the green dress walks to the window").
- narration: the one line of dialogue or voice-over in this shot, or "" for none. At most one line per shot.
- characters: names of the characters visible in the first frame, exactly as in the character list.

[Guidelines]
- Values in the language of the scene.
- Every shot has a narrative purpose: establish the place, show a relationship, catch a reaction.
- The first shot establishes the environment with the widest shot.
- Close-ups for emotion, wide shots for context. Use as few camera positions as possible.
- Say which way each character faces, and which body part a close shot focuses on.
- Each shot stands alone: never "same as before" or "continues from the last shot".
- Nothing invisible in a frame description (no one behind a closed door).
- Avoid unsafe content; use suggestion and substitutions (ketchup for blood).
"""

DESIGN_SHOTS_USER = """\
<SCENE>
{scene}
</SCENE>

<CHARACTERS>
{characters}
</CHARACTERS>

<USER_REQUIREMENT>
{requirement}
</USER_REQUIREMENT>
"""

PORTRAIT_PROMPT = """\
Character reference sheet: a full-body, front-view portrait of {name}, standing centred, arms relaxed at the sides,
gazing straight ahead with a natural expression, on a plain light background. This image is canonical: face, hair,
build, clothing and palette must be reusable as the reference for every later shot.
Features: (static) {static}; (dynamic) {dynamic}
Style: {style}
"""

FRAME_PROMPT = """\
First frame of a shot in a short film. {first_frame}
{cast}Style: {style}. Keep every character exactly on-model with the reference image: same face, hair, build,
clothing and palette.
"""
