"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { IconTile, PlanCard, StatusBadge, ToolIcon, type StatusTone, type ToolTone } from "@/design-system";
import type { AdAccount } from "@/lib/ads-client";
import { departmentById } from "@/lib/departments";
import { proxyFetch } from "@/lib/proxy-fetch";
import type { InboxKind } from "@/lib/workspace";

export const PLATFORM_LABEL: Record<string, string> = { google_ads: "Google Ads", meta_ads: "Meta Ads" };
export const platformLabel = (p: string) => PLATFORM_LABEL[p] ?? p.replace(/_/g, " ");

export const accountName = (a: Pick<AdAccount, "name" | "external_account_id" | "id">) => a.name || a.external_account_id || `Account ${a.id.slice(0, 6)}`;

export const mediaBuyer = () => departmentById("paid")?.agentName ?? "Media buyer";

/** The ad platform as a neutral tile with its initial (no hot-linked logos). */
export function PlatformTile({ platform, size = 28 }: { platform: string; size?: number }) {
  return (
    <IconTile size={size}>
      <span className="text-[12px] font-medium text-fg">{platformLabel(platform).slice(0, 1)}</span>
    </IconTile>
  );
}

const CAMPAIGN_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  active: { label: "Live", tone: "positive" },
  pending: { label: "Pending", tone: "attention" },
  draft: { label: "Draft", tone: "neutral" },
  paused: { label: "Paused", tone: "neutral" },
  ended: { label: "Ended", tone: "neutral" },
  failed: { label: "Failed", tone: "negative" },
};

export function AdStatusBadge({ status }: { status: string }) {
  const s = CAMPAIGN_STATUS[status] ?? { label: status, tone: "neutral" as StatusTone };
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}

const ACCOUNT_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  active: { label: "Connected", tone: "positive" },
  pending: { label: "Authorizing", tone: "attention" },
  error: { label: "Error", tone: "negative" },
  disconnected: { label: "Disconnected", tone: "neutral" },
};

export function AccountStatusBadge({ status }: { status: string }) {
  const s = ACCOUNT_STATUS[status] ?? { label: status, tone: "neutral" as StatusTone };
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}

export const capLabel = (v: string | null) => (v == null ? "No cap" : `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

/** "campaign.budget.change" → "Budget changed", for the audit trail. */
export function describeAdAction(action: string): { title: string; denied: boolean } {
  const map: Record<string, string> = {
    "account.governance": "Guardrails changed",
    "campaign.create": "Campaign created",
    "campaign.activate": "Campaign activated",
    "campaign.paused": "Campaign paused",
    "campaign.ended": "Campaign ended",
    "campaign.budget.change": "Budget changed",
    "approval.requested": "Approval requested",
    "approval.approved": "Approval granted",
    "approval.rejected": "Approval rejected",
    "campaign.activate.approval_requested": "Activation sent for approval",
  };
  const denied = action.includes("denied");
  const title = map[action] ?? action.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  return { title: denied && !map[action] ? `${title.replace(/ denied$/i, "")} denied` : title, denied };
}

/** Approve or reject one inbox item through the workspace decide endpoint (same path the inbox uses). */
export async function decideInboxItem(item: { kind: InboxKind; ref_id: string }, decision: "approve" | "reject") {
  try {
    await proxyFetch(`/api/v1/workspace/inbox/${item.kind}/${encodeURIComponent(item.ref_id)}/decide`, "POST", { decision });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    throw new Error(/already|409/i.test(msg) ? "Already decided." : msg);
  }
}

/** Time in the viewer's timezone, rendered after mount so server and client agree. */
export function LocalTime({ iso, format }: { iso: string; format: Intl.DateTimeFormatOptions }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => setText(new Date(iso).toLocaleString("en-US", format)), [iso, format]);
  return <span suppressHydrationWarning>{text ?? " "}</span>;
}

/**
 * One approval (ad change, scheduled post) as a PlanCard, wired to the
 * workspace decide call. Dismiss rejects; Approve & Run approves.
 */
export function ApprovalCard({ item, title, icon, steps, meta }: { item: { kind: InboxKind; ref_id: string }; title: string; icon?: ReactNode; steps: { label: ReactNode }[]; meta?: ReactNode }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [done, setDone] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (d: "approve" | "reject") => {
    setBusy(d);
    setError(null);
    try {
      await decideInboxItem(item, d);
      setDone(d);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PlanCard
        title={title}
        icon={icon}
        meta={meta}
        steps={steps}
        approving={busy === "approve"}
        decided={done ? (done === "approve" ? "Approved" : "Dismissed") : busy === "reject" ? "Dismissing…" : undefined}
        onDismiss={() => void decide("reject")}
        onApprove={() => void decide("approve")}
      />
      {error && <p className="mt-1.5 text-[12.5px] text-negative">{error}</p>}
    </div>
  );
}

/** Tool page title (README §5 Tool): the tool's coloured icon and its name. */
export function ToolTitle({ icon, tone, children }: { icon: ReactNode; tone: ToolTone; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2.5">
      <ToolIcon tone={tone} size={22}>
        {icon}
      </ToolIcon>
      {children}
    </span>
  );
}
