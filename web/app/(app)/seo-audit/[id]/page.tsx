import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { StoredAudit } from "@/lib/seo-audit-client";
import { AuditResultView } from "../AuditResultView";

export const dynamic = "force-dynamic";

async function fetchAudit(id: string): Promise<StoredAudit | null> {
  try {
    return await api<StoredAudit>(`/api/v1/seo-audits/${id}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // A foreign or unknown id is a 404 by design - never someone else's audit.
    if (msg.startsWith("404") || msg.startsWith("422")) return null;
    throw e;
  }
}

export default async function SeoAuditDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const stored = await fetchAudit(id);
  if (!stored) notFound();

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/seo-audit">Back to audits</Link>
      </Button>
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
          AI SEO audit
        </p>
        <h1 className="mt-2 break-all text-2xl font-semibold tracking-tight">
          {stored.host}
        </h1>
        <p className="text-sm text-muted-foreground">
          Scored {new Date(stored.created_at).toLocaleString()}
        </p>
      </div>
      <AuditResultView stored={stored} />
    </div>
  );
}
