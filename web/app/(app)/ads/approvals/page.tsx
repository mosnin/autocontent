import { api } from "@/lib/api";
import type { AdApproval } from "@/lib/ads-client";
import { ApprovalsClient } from "./ApprovalsClient";

export const dynamic = "force-dynamic";

export default async function AdsApprovalsPage() {
  let initial: AdApproval[] = [];
  try {
    initial = await api<AdApproval[]>("/api/v1/ads/approvals?status_filter=pending");
  } catch {
    initial = [];
  }
  return <ApprovalsClient initial={initial} />;
}
