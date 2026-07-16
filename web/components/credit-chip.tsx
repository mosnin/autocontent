"use client";

import Link from "next/link";
import useSWR from "swr";
import { Wallet } from "lucide-react";

import { clientFetch } from "@/lib/client-fetcher";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BillingBalance } from "@/lib/types";

// Money made visible. A returning user should never discover their balance
// only when a run fails 402 — so the shell header carries a live credit chip
// that turns brand-orange when it runs low and links straight to top-up.
export function CreditChip() {
  const { data } = useSWR<BillingBalance>(
    "/api/v1/billing/balance",
    clientFetch,
    { refreshInterval: 30000, shouldRetryOnError: false },
  );

  // Billing not wired up (or the call failed): show nothing rather than a
  // misleading zero.
  if (!data || !data.billing_enabled) return null;

  const balance = Number(data.balance_usd);
  const low = balance < 1;

  return (
    <Link
      href="/settings/billing"
      aria-label={`Available credit ${formatUsd(balance)}. Add credit.`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium transition-colors",
        low
          ? "bg-brand/10 text-brand hover:bg-brand/15"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Wallet className="size-3.5" aria-hidden />
      <span className="font-mono tabular-nums">{formatUsd(balance)}</span>
      {low && <span className="hidden sm:inline">· Add credit</span>}
    </Link>
  );
}
