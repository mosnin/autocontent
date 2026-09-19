"""TypeSafe System One primitives: Noul, Choice, Score.

Mirrors https://docs.typesafe.ai/primitives — these are the only
question types Jev answers. Code composes them; Jev never generates text.
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

QuestionType = Literal["noul", "choice", "score"]
State = str | dict[str, Any] | list[Any]


class Noul(BaseModel):
    """Yes/no question. Answer is P(yes) in ``[0, 1]``."""

    type: Literal["noul"] = "noul"
    instructions: str
    criteria: dict[str, str] | None = None

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "type": "noul",
            "instructions": self.instructions,
        }
        if self.criteria:
            payload["criteria"] = self.criteria
        return payload


class Choice(BaseModel):
    """Pick one option from a closed set (2–255)."""

    type: Literal["choice"] = "choice"
    instructions: str
    criteria: dict[str, str | None]

    @model_validator(mode="after")
    def _bounds(self) -> Choice:
        n = len(self.criteria)
        if n < 2 or n > 255:
            raise ValueError(f"Choice requires 2-255 options, got {n}")
        return self

    def to_payload(self) -> dict[str, Any]:
        return {
            "type": "choice",
            "instructions": self.instructions,
            "criteria": self.criteria,
        }


class Score(BaseModel):
    """Rate against an ordered rubric (2–10 levels)."""

    type: Literal["score"] = "score"
    instructions: str
    criteria: list[str]

    @model_validator(mode="after")
    def _bounds(self) -> Score:
        n = len(self.criteria)
        if n < 2 or n > 10:
            raise ValueError(f"Score requires 2-10 levels, got {n}")
        return self

    def to_payload(self) -> dict[str, Any]:
        return {
            "type": "score",
            "instructions": self.instructions,
            "criteria": self.criteria,
        }


Question = Noul | Choice | Score
Questions = Mapping[str, Question]


class NoulAnswer(BaseModel):
    type: Literal["noul"] = "noul"
    noul: float = Field(ge=0.0, le=1.0)

    def is_yes(self, threshold: float = 0.5) -> bool:
        return self.noul >= threshold


class ChoiceAnswer(BaseModel):
    type: Literal["choice"] = "choice"
    choice: str
    probabilities: dict[str, float] = Field(default_factory=dict)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class ScoreAnswer(BaseModel):
    type: Literal["score"] = "score"
    score: float
    legend: dict[str, str] = Field(default_factory=dict)
    probabilities: dict[str, float] = Field(default_factory=dict)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)

    def normalized(self) -> float:
        """Map the weighted score onto ``[0, 1]`` using the legend length."""
        top = max(len(self.legend) - 1, 1)
        return max(0.0, min(1.0, self.score / top))


Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer


class Usage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0


class SystemOneResult(BaseModel):
    """Typed answers keyed by the question ids the caller sent."""

    model: str
    answers: dict[str, Answer]
    usage: Usage = Field(default_factory=Usage)
    backend: Literal["jev", "qwen"] = "jev"

    def noul(self, key: str) -> NoulAnswer:
        ans = self.answers[key]
        if not isinstance(ans, NoulAnswer):
            raise TypeError(f"answer {key!r} is {ans.type}, not noul")
        return ans

    def choice(self, key: str) -> ChoiceAnswer:
        ans = self.answers[key]
        if not isinstance(ans, ChoiceAnswer):
            raise TypeError(f"answer {key!r} is {ans.type}, not choice")
        return ans

    def score(self, key: str) -> ScoreAnswer:
        ans = self.answers[key]
        if not isinstance(ans, ScoreAnswer):
            raise TypeError(f"answer {key!r} is {ans.type}, not score")
        return ans

    def as_serializable(self) -> dict[str, Any]:
        return self.model_dump()


def parse_answer(raw: dict[str, Any]) -> Answer:
    kind = raw.get("type")
    if kind == "noul":
        return NoulAnswer.model_validate(raw)
    if kind == "choice":
        return ChoiceAnswer.model_validate(raw)
    if kind == "score":
        return ScoreAnswer.model_validate(raw)
    raise ValueError(f"unknown System One answer type: {kind!r}")


def questions_payload(questions: Questions) -> dict[str, Any]:
    return {key: q.to_payload() for key, q in questions.items()}
