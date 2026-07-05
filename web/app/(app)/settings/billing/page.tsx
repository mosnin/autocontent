import { api } from "@/lib/api";
import type { BillingBalance } from "@/lib/types";
import { BillingClient } from "./BillingClient";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const balance = await api<BillingBalance>("/api/v1/billing/balance");

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
          Billing
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Pipeline credits
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Videos draw down prepaid credit at provider cost plus a{" "}
          {Math.round((balance.margin - 1) * 100)}% infrastructure margin.
          The spend guard refuses any call your balance can&apos;t cover —
          you can never owe us money.
        </p>
      </div>

      <BillingClient initial={balance} />
    </div>
  );
}
