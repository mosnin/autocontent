import { api } from "@/lib/api";
import type { UgcModelCatalog, UgcRender } from "@/lib/ugc-client";
import type { Niche } from "@/lib/types";
import { UgcClient } from "./UgcClient";

export const dynamic = "force-dynamic";

/** The UGC studio is fail-closed on config: with MARKETER_UGC_ENABLED false
 *  or MARKETER_MUAPI_API_KEY unset, every user-facing route answers 409 with
 *  a human-readable reason. That is a legitimate deployment state, not an
 *  error — we surface the reason and render a calm empty state. */
function configReason(e: unknown): string | null {
  const msg = e instanceof Error ? e.message : String(e);
  if (!msg.startsWith("409")) return null;
  // `409 {"detail":"the UGC studio is disabled (set MARKETER_UGC_ENABLED=true)"}`
  const match = msg.match(/"detail"\s*:\s*"([^"]+)"/);
  return match ? match[1] : "The UGC studio is not configured on this deployment.";
}

export default async function UgcPage() {
  let catalog: UgcModelCatalog | null = null;
  let renders: UgcRender[] = [];
  let notConfigured: string | null = null;

  try {
    catalog = await api<UgcModelCatalog>("/api/v1/ugc/models");
  } catch (e) {
    notConfigured = configReason(e);
    // A non-409 failure (backend down, network) also degrades to the empty
    // state rather than crashing the route — same rule as ads/approvals.
    if (!notConfigured) catalog = null;
  }

  if (catalog) {
    try {
      renders = await api<UgcRender[]>("/api/v1/ugc/renders?limit=50");
    } catch {
      renders = [];
    }
  }

  let niches: Niche[] = [];
  try {
    niches = await api<Niche[]>("/api/v1/niches");
  } catch {
    niches = [];
  }

  return (
    <UgcClient
      initialCatalog={catalog}
      initialRenders={renders}
      niches={niches}
      notConfigured={notConfigured}
    />
  );
}
