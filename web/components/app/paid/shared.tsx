"use client";

import { IconTile, StatusBadge, type StatusTone } from "@/design-system";
import type { AdAccount } from "@/lib/ads-client";
import { departmentById } from "@/lib/departments";

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
