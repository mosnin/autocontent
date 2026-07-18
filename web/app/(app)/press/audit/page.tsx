import { api } from "@/lib/api";
import type { Article } from "@/lib/types";
import type { ArticleAudit, CannibalizationFinding } from "@/lib/press-analytics-client";
import { AuditClient } from "./AuditClient";

export const dynamic = "force-dynamic";

// Content audit: score every done article from stored data (no LLM call),
// flag ones needing attention, and scan for keyword cannibalization pairs.
export default async function AuditPage() {
  const [audits, findings, articles] = await Promise.all([
    api<ArticleAudit[]>("/api/v1/intelligence/audit"),
    api<CannibalizationFinding[]>("/api/v1/intelligence/cannibalization"),
    api<Article[]>("/api/v1/articles?status_filter=done&limit=200"),
  ]);

  return <AuditClient initialAudits={audits} initialFindings={findings} articles={articles} />;
}
