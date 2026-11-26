// Design-review preview of the plan screen (no sign-in, no API): /preview/plans
// ?theme=light, ?member=1 (a role that can't buy), ?purchase=success|cancelled.
// The buttons call the real API and fail harmlessly here.
import { PlansView } from "@/components/app/plans/plans-view";
import { themeClass } from "@/components/shell/theme";
import type { BillingAccess } from "@/lib/billing-access";

export const dynamic = "force-dynamic";

const ACCESS: BillingAccess = {
  billing_enabled: true,
  needs_plan: true,
  can_manage: true,
  balance_usd: "0",
  has_purchased: false,
  redemption: null,
  packs: [
    { id: "starter", amount_usd: "5", credit_usd: "5.00" },
    { id: "creator", amount_usd: "20", credit_usd: "20.00" },
    { id: "studio", amount_usd: "50", credit_usd: "50.00" },
  ],
};

export default async function PreviewPlans({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const purchase = q.purchase === "success" ? "success" : q.purchase === "cancelled" ? "cancelled" : null;
  return (
    <div className={themeClass(q.theme === "light" ? "light" : "dark")}>
      <PlansView access={{ ...ACCESS, can_manage: q.member !== "1" }} start={{ nicheId: "preview-niche", kind: "video", next: "/home" }} brand="Pasta Club" email="sam@pastaclub.co" purchase={purchase} />
    </div>
  );
}
