import { api } from "@/lib/api";
import type { SeoAuditSummary } from "@/lib/seo-audit-client";
import { SeoAuditClient } from "./SeoAuditClient";

export const dynamic = "force-dynamic";

export default async function SeoAuditPage() {
  // The list endpoint does not check the auditor's feature flag (only the POST
  // does), so a failure here is a real fetch failure — fall back to empty and
  // let the surface render rather than erroring the whole page.
  let initial: SeoAuditSummary[] = [];
  try {
    initial = await api<SeoAuditSummary[]>("/api/v1/seo-audits?limit=50");
  } catch {
    initial = [];
  }
  return <SeoAuditClient initial={initial} />;
}
