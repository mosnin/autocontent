// The plan screen's contract with the backend (GET /api/v1/billing/access,
// POST /api/v1/billing/redeem). See docs/billing/access-codes.md.

export interface BillingPack {
  id: "starter" | "creator" | "studio" | string;
  amount_usd: string;
  credit_usd: string;
}

export interface CodeRedemption {
  kind: "invite" | "pilot";
  credit_usd: string;
  trial_days: number | null;
  access_until: string | null;
  redeemed_at: string;
}

export interface BillingAccess {
  billing_enabled: boolean;
  /** Billing is on, the balance is empty, no pack was ever bought and no code redeemed. */
  needs_plan: boolean;
  can_manage: boolean;
  balance_usd: string | null;
  has_purchased: boolean;
  redemption: CodeRedemption | null;
  packs: BillingPack[];
}

export type RedeemError = "code_unknown" | "code_expired" | "code_used_up" | "code_already_redeemed";

/** One plain sentence per redeem failure, keyed by the backend's stable code. */
export function redeemErrorMessage(detail: string | null | undefined, status?: number): string {
  switch (detail) {
    case "code_unknown":
      return "We couldn't find that code. Check it and try again.";
    case "code_expired":
      return "That code is no longer active. Ask whoever gave it to you for a new one.";
    case "code_used_up":
      return "That code has been used as many times as it allows.";
    case "code_already_redeemed":
      return "This workspace has already used that code.";
    case "person_only":
      return "Codes are redeemed by a person, not an API token or the agent.";
    case "forbidden":
      return "Only owners, admins and billing members can redeem codes.";
  }
  if (status === 401) return "Your session ended. Sign in again, then redeem the code.";
  if (status === 429) return "Too many tries. Wait a minute and try again.";
  if (status === 503) return "Codes aren't available on this deployment.";
  return "That didn't work. Try again in a moment.";
}

/** The plan cards, in plain words, built from the backend's packs. Order and copy only; prices come from the server. */
export const PLAN_COPY: Record<string, { title: string; line: string; points: string[]; palette: "sky" | "dusk" | "ember" | "lagoon" | "sunrise" | "bloom"; recommended?: boolean }> = {
  starter: { title: "Starter", line: "Try it on your brand", points: ["About 8 to 12 short videos", "Or 20 or so articles", "Every feature included"], palette: "lagoon" },
  creator: { title: "Creator", line: "A post every day for a month", points: ["About 35 to 50 short videos", "Gets better at what works for you", "Review before anything posts"], palette: "dusk", recommended: true },
  studio: { title: "Studio", line: "Several brands or channels at once", points: ["About 90 to 125 short videos", "Separate spend caps per playbook", "API and MCP access for your agents"], palette: "ember" },
};
