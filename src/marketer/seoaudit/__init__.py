"""SEO Auditor — AI answer-engine readability scoring for a single URL.

Ported from the `ai-seo-audit` Next.js app. The layering is preserved so the
two stay diffable:

    parsing.py      HTML/Markdown -> structured facts   (was lib/audit.ts, bottom half)
    rules.py        the authoritative rule catalog      (was lib/rules.ts)
    scoring.py      category math + score bands         (was lib/audit.ts, scoring)
    agent_prompt.py failing rules -> agent fix prompt   (was lib/agent-fix-prompt.ts)
    audit.py        orchestration + cache key           (was lib/audit.ts / perform-audit.ts)

To change *what* is measured, edit `rules.py` — everything downstream
(scoring, prompts, UI) derives from that catalog.

Page bytes only ever arrive through `services.context_dev`. Nothing in this
package may fetch the audited site directly: Context.dev owns rendering and
robots compliance, and that is a hard architectural rule inherited from the
source app.
"""
from __future__ import annotations

from .audit import (
    CACHE_SCHEMA_VERSION,
    SeoAuditDisabled,
    audit_cache_key,
    display_host,
    ensure_enabled,
    normalize_audit_url,
    run_audit,
)
from .rules import CATEGORIES, RULES, RuleContext
from .types import (
    AgentFixPrompts,
    AuditBand,
    AuditCategory,
    AuditItem,
    AuditResult,
    AuditStatus,
)

__all__ = [
    "CACHE_SCHEMA_VERSION",
    "CATEGORIES",
    "RULES",
    "AgentFixPrompts",
    "AuditBand",
    "AuditCategory",
    "AuditItem",
    "AuditResult",
    "AuditStatus",
    "RuleContext",
    "SeoAuditDisabled",
    "audit_cache_key",
    "display_host",
    "ensure_enabled",
    "normalize_audit_url",
    "run_audit",
]
