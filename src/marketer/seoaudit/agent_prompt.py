"""Turn failing rules into copy-paste prompts for a coding agent.

Port of lib/agent-fix-prompt.ts. Two shapes come out of one audit:

*   ``full`` — every actionable finding, in priority order, as one prompt.
*   ``top_issues`` — the eight highest-impact findings as standalone prompts,
    for users who want to hand an agent one fix at a time.

The prompts deliberately forbid fabricating authority, reviews, authorship,
credentials, dates, and analytics evidence: several rules reward signals an
agent could trivially invent, and inventing them is worse than failing them.
"""
from __future__ import annotations

from dataclasses import dataclass

from .types import AgentFixPrompts, AgentIssuePrompt, AuditResult, AuditStatus

ACTIONABLE_STATUSES = frozenset({AuditStatus.fail, AuditStatus.partial})

#: How many findings get their own standalone prompt.
TOP_ISSUE_COUNT = 8


@dataclass
class _PromptIssue:
    id: str
    label: str
    status: AuditStatus
    evidence: str
    recommendation: str
    max_score: float
    category_id: str
    category_name: str


def build_agent_fix_prompts(audit: AuditResult) -> AgentFixPrompts:
    issues = [
        _PromptIssue(
            id=item.id,
            label=item.label,
            status=item.status,
            evidence=item.evidence,
            recommendation=item.recommendation,
            max_score=item.max_score,
            category_id=category.id,
            category_name=category.name,
        )
        for category in audit.categories
        for item in category.items
    ]

    # Highest possible point gain first; id breaks ties so the prompt is
    # byte-stable for the same audit (it gets pasted into diffs and issues).
    actionable = sorted(
        (issue for issue in issues if issue.status in ACTIONABLE_STATUSES),
        key=lambda issue: (-issue.max_score, issue.id),
    )

    return AgentFixPrompts(
        full=_build_full_prompt(audit, actionable),
        top_issues=[
            AgentIssuePrompt(
                id=issue.id, label=issue.label, prompt=_build_issue_prompt(audit, issue)
            )
            for issue in actionable[:TOP_ISSUE_COUNT]
        ],
    )


def _build_full_prompt(audit: AuditResult, actionable: list[_PromptIssue]) -> str:
    issue_lines = (
        "\n\n".join(_format_issue(issue) for issue in actionable)
        if actionable
        else "No failing or partial automated checks were found."
    )

    return f"""You are an AI SEO implementation agent. Improve the audited page so it is easier for AI answer engines to crawl, parse, trust, and cite.

Target URL: {audit.url}
Current score: {audit.score}/100 ({audit.band.label})
Audit source: guidelines.md in this repository

Rules:
- Fix the issues below in priority order.
- Preserve the page's existing product intent and brand voice.
- Do not fabricate off-site authority, reviews, authorship, credentials, dates, or analytics evidence.
- Prefer server-rendered HTML for critical copy, headings, FAQs, schema, and metadata.
- After changes, run the project's lint, typecheck, and build commands if available.

Automated issues to fix:
{issue_lines}

Expected output from you:
1. A concise summary of what changed.
2. The files changed.
3. The verification commands run and their results."""


def _build_issue_prompt(audit: AuditResult, issue: _PromptIssue) -> str:
    return f"""You are an AI SEO implementation agent. Fix this single audit finding.

Target URL: {audit.url}
Finding: {issue.id} {issue.label}
Category: {issue.category_name}
Status: {issue.status}
Score impact: {issue.max_score:.1f} possible points
Evidence: {issue.evidence}
Required fix: {issue.recommendation}

Acceptance criteria:
- The fix is visible in raw server-rendered HTML when relevant.
- The change does not fabricate facts, off-site authority, authors, credentials, or dates.
- The page remains useful to human readers.
- Lint, typecheck, and build pass if this is a codebase change.

Report back with files changed and verification performed."""


def _format_issue(issue: _PromptIssue) -> str:
    return f"""- {issue.id} {issue.label}
  Category: {issue.category_name}
  Status: {issue.status}
  Score impact: {issue.max_score:.1f} possible points
  Evidence: {issue.evidence}
  Required fix: {issue.recommendation}"""
