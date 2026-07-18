// Humanize the ad platform's wire enums for display. The API speaks in
// lowercase snake_case (objective: "app_installs", status: "pending"); users
// should never see the raw token. One place so every ads surface agrees.
//
// This module is plain TS (no "use client"), so it's safe to import from
// both server components and client components alike.

import type { BadgeVariant } from "@/components/ui/badge";

export const AD_OBJECTIVES = [
  "conversions",
  "traffic",
  "awareness",
  "leads",
  "app_installs",
  "sales",
] as const;

const OBJECTIVE_LABEL: Record<string, string> = {
  conversions: "Conversions",
  traffic: "Traffic",
  awareness: "Awareness",
  leads: "Leads",
  app_installs: "App installs",
  sales: "Sales",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending: "Pending review",
  active: "Active",
  paused: "Paused",
  ended: "Ended",
  failed: "Failed",
  disconnected: "Disconnected",
  error: "Error",
  executed: "Executed",
  pending_approval: "Awaiting approval",
};

function titleCase(raw: string): string {
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function objectiveLabel(objective: string): string {
  return OBJECTIVE_LABEL[objective] ?? titleCase(objective);
}

export function adStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? titleCase(status);
}

/** Humanize an ad platform slug, e.g. "meta_ads" -> "Meta ads". */
export function adPlatformLabel(platform: string): string {
  return titleCase(platform);
}

/** Badge tone for a campaign/account status. Shared across campaign lists,
 *  the campaign detail page, and insights so a given status always reads
 *  the same color. */
export function adStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case "active":
      return "success";
    case "paused":
      return "warning";
    case "failed":
      return "destructive";
    case "draft":
      return "secondary";
    default:
      return "outline";
  }
}

/** Turn a thrown ads-client error (message shaped "<status> <body>", body
 *  often JSON like {"detail": "..."}) into a short, humane toast string.
 *  409 means Ads/Composio isn't enabled; 402 means governance refused the
 *  action (the reason is already human-readable); 502 means the platform
 *  call itself failed. Never surfaces raw JSON or a stack trace. */
export function describeAdsError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const match = raw.match(/^(\d{3})\s*(.*)$/s);
  const status = match?.[1];
  const body = match?.[2] ?? raw;

  let detail = body;
  try {
    const parsed = JSON.parse(body) as { detail?: unknown };
    if (typeof parsed.detail === "string" && parsed.detail) detail = parsed.detail;
  } catch {
    // body wasn't JSON, use it as-is
  }

  if (status === "409") {
    return "Connect an ad account and enable Ads to continue.";
  }
  if (status === "402") {
    return detail || "That change was refused by your spend guardrails.";
  }
  if (status === "502") {
    return detail || "The platform call failed. Try again.";
  }
  return detail || "Something went wrong.";
}
