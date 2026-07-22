import { Card, CardContent } from "@/components/square/ui/card";
import { api } from "@/lib/api";
import type { BillingBalance } from "@/lib/types";
import { BillingClient } from "./BillingClient";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  // Best-effort: a backend 5xx must not throw the whole route to the error
  // boundary — render an in-page fallback instead.
  let balance: BillingBalance | null = null;
  try {
    balance = await api<BillingBalance>("/api/v1/billing/balance");
  } catch {
    // fall through to the graceful fallback below
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
          Billing
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Pipeline credits
        </h1>
        {balance ? (
          <p className="mt-1.5 text-sm text-muted-foreground">
            Videos draw down prepaid credit at provider cost plus a{" "}
            {Math.round((balance.margin - 1) * 100)}% infrastructure margin.
            The spend guard refuses any call your balance can&apos;t cover —
            you can never owe us money.
          </p>
        ) : (
          <p className="mt-1.5 text-sm text-muted-foreground">
            Videos draw down prepaid credit; the spend guard refuses any call
            your balance can&apos;t cover.
          </p>
        )}
      </div>

      {balance ? (
        <BillingClient initial={balance} />
      ) : (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="pt-6">
            <div className="font-medium">
              Couldn&apos;t load your billing right now
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              We hit a problem reaching the billing service. Your credit is
              safe — refresh in a moment to try again.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
