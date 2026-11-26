import { redirect } from "next/navigation";
import { PlansView } from "@/components/app/plans/plans-view";
import { nextPath } from "@/components/auth/next-path";
import { getAuthContext } from "@/lib/auth/session";
import type { BillingAccess } from "@/lib/billing-access";
import type { BrandKit } from "@/lib/brand-kit-client";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Choose how to start · Marketer" };

/**
 * The plan screen, after onboarding and before the dashboard, for a workspace
 * with nothing to run on (docs/billing/access-codes.md). A workspace that has
 * credit, a purchase or a redeemed code goes straight on, unless it is coming
 * back from Stripe (the view confirms the payment, then goes on).
 */
export default async function PlansPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const nicheId = q.start && /^[A-Za-z0-9_-]{1,64}$/.test(q.start) ? q.start : null;
  const kind = q.kind === "article" ? "article" : q.kind === "video" ? "video" : null;
  const next = nextPath(q.next);
  const purchase = q.purchase === "success" ? "success" : q.purchase === "cancelled" ? "cancelled" : null;
  const [ctx, access, brand] = await Promise.all([getAuthContext().catch(() => null), safe<BillingAccess>("/api/v1/billing/access"), safe<BrandKit>("/api/v1/brand-kit")]);
  if (access && !access.needs_plan && !purchase && !nicheId) redirect(next);
  return (
    <PlansView
      access={access}
      start={{ nicheId: nicheId && kind ? nicheId : null, kind: nicheId ? kind : null, next }}
      brand={brand?.brand_name || ctx?.membership?.organizationName || ""}
      email={ctx?.user.email ?? ""}
      purchase={purchase}
      ready={Boolean(access && !access.needs_plan && !purchase)}
    />
  );
}
