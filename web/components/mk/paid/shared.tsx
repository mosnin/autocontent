import type { ReactNode } from "react";
import { departmentById } from "@/lib/departments";
import type { AdAccount } from "@/lib/ads-client";
import { AgentAvatar, Badge, IconTile, PersonAvatar, type Tone } from "../ui";

export const PLATFORM_LABEL: Record<string, string> = { google_ads: "Google Ads", meta_ads: "Meta Ads" };
export const platformLabel = (p: string) => PLATFORM_LABEL[p] ?? p.replace(/_/g, " ");

/** The ad platform as a quiet tile with its initial (no hot-linked logos). */
export function PlatformTile({ platform, size = 32 }: { platform: string; size?: number }) {
  return (
    <IconTile size={size}>
      <span className="text-[13px] font-medium">{platformLabel(platform).slice(0, 1)}</span>
    </IconTile>
  );
}

const CAMPAIGN_STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: "Live", tone: "live" },
  pending: { label: "Pending", tone: "warn" },
  draft: { label: "Draft", tone: "muted" },
  paused: { label: "Paused", tone: "muted" },
  ended: { label: "Ended", tone: "muted" },
  failed: { label: "Failed", tone: "danger" },
};

export function AdStatusBadge({ status }: { status: string }) {
  const s = CAMPAIGN_STATUS[status] ?? { label: status, tone: "muted" as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const ACCOUNT_STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: "Connected", tone: "live" },
  pending: { label: "Authorizing", tone: "warn" },
  error: { label: "Error", tone: "danger" },
  disconnected: { label: "Disconnected", tone: "muted" },
};

export function AccountStatusBadge({ status }: { status: string }) {
  const s = ACCOUNT_STATUS[status] ?? { label: status, tone: "muted" as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const accountName = (a: Pick<AdAccount, "name" | "external_account_id" | "id">) => a.name || a.external_account_id || `Account ${a.id.slice(0, 6)}`;

/** Who did it: the Media buyer agent (its palette) or a person. */
export function ActorAvatar({ actor, email, size = 28 }: { actor: string; email?: string; size?: number }) {
  if (actor === "agent") {
    const d = departmentById("paid");
    return <AgentAvatar name={d?.agentName ?? "Media buyer"} palette={d?.palette} size={size} />;
  }
  return <PersonAvatar name={email || "You"} size={size} />;
}

export function actorLabel(actor: string, email?: string): string {
  if (actor === "agent") return departmentById("paid")?.agentName ?? "Media buyer";
  return email || "You";
}

/** "campaign.budget.change" → "Budget changed", for the audit trail's first line. */
export function describeAdAction(action: string): { title: string; tone: Tone | null } {
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
  const tone: Tone | null = action.includes("denied") ? "danger" : action.includes("approval") || action.includes("governance") ? "warn" : null;
  const title = map[action] ?? action.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  return { title: action.includes("denied") && !map[action] ? `${title.replace(/ denied$/i, "")} denied` : title, tone };
}

export function GuardLine({ children }: { children: ReactNode }) {
  return <p className="text-[12.5px] leading-relaxed text-muted-foreground">{children}</p>;
}
