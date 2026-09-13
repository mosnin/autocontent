"""Production metadata beside an existing creative, with explicit review intent."""

from typing import Literal
from pydantic import BaseModel, Field, ConfigDict, HttpUrl


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class RequiredInput(StrictModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    label: str = Field(min_length=1, max_length=240)
    status: Literal["missing", "available", "unverified"] = "missing"
    evidence: str = Field(default="", max_length=1000)


class ContextPin(StrictModel):
    label: str = Field(min_length=1, max_length=160)
    url: HttpUrl
    revision: str = Field(min_length=1, max_length=240)
    excerpt: str = Field(default="", max_length=3000)


class ProductionBrief(StrictModel):
    objective: str = Field(default="", max_length=2000)
    audience: str = Field(default="", max_length=1500)
    owner: str = Field(default="", max_length=240)
    deliverable: str = Field(default="", max_length=2000)
    due_date: str = Field(default="", pattern=r"^$|^\d{4}-\d{2}-\d{2}$")
    inputs: list[RequiredInput] = Field(default_factory=list, max_length=50)
    context: list[ContextPin] = Field(default_factory=list, max_length=20)
    variant_of: str = Field(default="", max_length=100)
    hypothesis: str = Field(default="", max_length=1500)


class ProductionCommand(StrictModel):
    action: Literal["save", "note", "resolve", "approve", "handoff", "outcome"]
    expected_version: int = Field(ge=0)
    source_fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    brief: ProductionBrief | None = None
    text: str = Field(default="", max_length=3000)
    anchor: str = Field(default="whole", max_length=80)
    blocking: bool = True
    note_id: str = Field(default="", max_length=80)
    evidence_url: HttpUrl | None = None
    handoff_version: int | None = Field(default=None, ge=1)


def readiness(source: dict, state: dict) -> list[str]:
    brief = state.get("brief") or {}
    issues = []
    for key, label in (
        ("objective", "Objective"),
        ("audience", "Audience"),
        ("owner", "Owner"),
        ("deliverable", "Delivery requirements"),
    ):
        if not str(brief.get(key, "")).strip():
            issues.append(f"{label} is missing")
    for item in brief.get("inputs", []):
        if item["status"] != "available" or not item.get("evidence", "").strip():
            issues.append(f"Input needs verification: {item['label']}")
    if not source.get("has_output", False):
        issues.append("The source has no completed creative output")
    # Pending/failed work cannot be handed off just because a brief is filled in.
    if source["item"]["status"] not in {
        "available",
        "completed",
        "complete",
        "ready",
        "rendered",
        "awaiting_approval",
        "approved",
        "scheduled",
        "published",
        "done",
        "draft",
        "active",
        "paused",
    }:
        issues.append("The source creative is not ready for review")
    for note in state.get("notes", []):
        if note["blocking"] and not note.get("resolved_at"):
            issues.append("Resolve review note: " + note["text"][:120])
    return issues


def approval_current(source: dict, state: dict, brief_version: int) -> bool:
    approval = state.get("approval") or {}
    return (
        approval.get("source_fingerprint") == source["fingerprint"]
        and approval.get("brief_version") == brief_version
        and not readiness(source, state)
    )
