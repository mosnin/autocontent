"""Video formats: the narrative shape of a short, and how to grade one.

Pure data + pure functions: no I/O, no network, no DB anywhere in this
package. That is what makes it safe for the pipeline to import at module
scope, and what lets CI grade scripts offline for free.

Module map
----------
``beats``     the beat contract model, shot planning, and script grading.
``registry``  the format catalog (explainer, myth buster, what-if,
              listicle, tutorial, UGC testimonial) + prompt assembly.
``explainer`` the narrated-documentary format's own craft: contract,
              cadence, voice direction, and scriptwriter prompt.
``gotchas``   per-model failure modes and the prompt rules that avoid
              them, consulted before any paid generation call.

The stateful half of this feature — trend reports produced for a niche —
lives in `marketer.research.trends` and `marketer.repos.trend_reports`,
because it is the only part that talks to a network or a database.
"""
from __future__ import annotations

from .beats import (
    OPEN_LOOP_MARKERS,
    BeatContract,
    BeatContractSummary,
    BeatRole,
    BeatSpec,
    Pacing,
    ShotPlan,
    VoiceDirection,
    assign_roles,
    check_script,
    contract_summary,
    plan_shots,
    score_beats,
)
from .gotchas import (
    GOTCHAS,
    GotchaSummary,
    ModelGotcha,
    apply_prompt_rules,
    check_prompt,
    gotchas_for,
    prompt_rules,
    rules_block,
    summaries as gotcha_summaries,
)
from .registry import (
    DEFAULT_FORMAT_KEY,
    FORMAT_KEYS,
    FORMATS,
    FormatDetail,
    FormatSummary,
    UnknownFormatKey,
    VideoFormat,
    check,
    detail,
    get_format,
    resolve,
    scriptwriter_directives,
    summaries,
    summary,
)

__all__ = [
    "DEFAULT_FORMAT_KEY",
    "FORMATS",
    "FORMAT_KEYS",
    "GOTCHAS",
    "OPEN_LOOP_MARKERS",
    "BeatContract",
    "BeatContractSummary",
    "BeatRole",
    "BeatSpec",
    "FormatDetail",
    "FormatSummary",
    "GotchaSummary",
    "ModelGotcha",
    "Pacing",
    "ShotPlan",
    "UnknownFormatKey",
    "VideoFormat",
    "VoiceDirection",
    "apply_prompt_rules",
    "assign_roles",
    "check",
    "check_prompt",
    "check_script",
    "contract_summary",
    "detail",
    "get_format",
    "gotcha_summaries",
    "gotchas_for",
    "plan_shots",
    "prompt_rules",
    "resolve",
    "rules_block",
    "score_beats",
    "scriptwriter_directives",
    "summaries",
    "summary",
]
