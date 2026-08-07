"""Wire types for an audit result (port of lib/audit-types.ts).

Pydantic models rather than dataclasses because these are the FastAPI
response bodies *and* the jsonb blob persisted in `seo_audits.result` —
one definition has to serve serialization, validation, and storage.

Field names are snake_case, unlike the TypeScript source's camelCase, to
match every other model this API returns.
"""
from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class AuditStatus(str, Enum):
    """Outcome of a single rule.

    `na` means the rule did not apply to this page: it earns no credit and
    is removed from its category's denominator entirely (see scoring.py).
    """

    passed = "pass"
    partial = "partial"
    fail = "fail"
    na = "na"

    # Rules and prompts interpolate statuses into evidence strings. Python
    # 3.11 made the default Enum __format__ emit "AuditStatus.fail", which
    # would leak the class name into user-visible copy; pin both hooks to
    # the wire value instead.
    def __str__(self) -> str:
        return self.value

    def __format__(self, spec: str) -> str:
        return format(self.value, spec)


class AuditItem(BaseModel):
    """One evaluated rule, with the points it earned out of its share."""

    id: str
    label: str
    status: AuditStatus
    evidence: str
    recommendation: str
    score: float
    max_score: float


class AuditCategory(BaseModel):
    id: str
    name: str
    description: str
    score: float
    max_score: float
    #: Rules dropped because they did not apply to this page.
    na_excluded: int = 0
    items: list[AuditItem] = Field(default_factory=list)


class AuditBand(BaseModel):
    label: str
    interpretation: str


class AgentIssuePrompt(BaseModel):
    id: str
    label: str
    prompt: str


class AgentFixPrompts(BaseModel):
    full: str = ""
    top_issues: list[AgentIssuePrompt] = Field(default_factory=list)


class AuditStats(BaseModel):
    markdown_chars: int = 0
    raw_html_chars: int = 0
    words: int = 0
    headings: int = 0
    links: int = 0
    external_links: int = 0
    json_ld_blocks: int = 0


class AuditDiagnostics(BaseModel):
    """How the two Context.dev scrapes went, so a low score can be read as
    "the page is weak" rather than "the scrape came back empty"."""

    #: "ready" | "empty" | "failed"
    context_dev_markdown: str = "empty"
    context_dev_html: str = "empty"
    json_ld_parse_failures: int = 0


class AuditResult(BaseModel):
    url: str
    host: str
    title: str | None = None
    description: str | None = None
    fetched_at: str
    score: float
    band: AuditBand
    top_priorities: list[str] = Field(default_factory=list)
    # Defaulted so the result can be assembled first and have prompts
    # attached afterwards — the prompt builder reads the scored categories.
    agent_prompts: AgentFixPrompts = Field(default_factory=AgentFixPrompts)
    stats: AuditStats = Field(default_factory=AuditStats)
    categories: list[AuditCategory] = Field(default_factory=list)
    diagnostics: AuditDiagnostics = Field(default_factory=AuditDiagnostics)
