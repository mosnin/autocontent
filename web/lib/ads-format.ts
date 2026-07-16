// Humanize the ad platform's wire enums for display. The API speaks in
// lowercase snake_case (objective: "app_installs", status: "pending"); users
// should never see the raw token. One place so every ads surface agrees.

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
