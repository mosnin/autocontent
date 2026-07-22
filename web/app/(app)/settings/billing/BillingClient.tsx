"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/square/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/square/ui/table";
import { createCheckoutAction } from "@/lib/actions";
import { clientFetch } from "@/lib/client-fetcher";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BillingBalance } from "@/lib/types";

interface Pack {
  key: string;
  label: string;
  amount: number;
  blurb: string;
  featured?: boolean;
}

const PACKS: Pack[] = [
  { key: "starter", label: "Starter", amount: 5, blurb: "Try the machine" },
  { key: "creator", label: "Creator", amount: 20, blurb: "A daily channel", featured: true },
  { key: "studio", label: "Studio", amount: 50, blurb: "Several niches" },
];

export function BillingClient({ initial }: { initial: BillingBalance }) {
  const { data } = useSWR<BillingBalance>("/api/v1/billing/balance", clientFetch, {
    refreshInterval: 15000,
    fallbackData: initial,
  });
  const billing = data ?? initial;
  const [buying, setBuying] = React.useState<string | null>(null);

  // Surface the checkout redirect result once.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("purchase");
    if (outcome === "success") {
      toast.success("Payment received — credit lands as soon as Stripe confirms");
      window.history.replaceState({}, "", "/settings/billing");
    } else if (outcome === "cancelled") {
      toast("Checkout cancelled");
      window.history.replaceState({}, "", "/settings/billing");
    }
  }, []);

  async function buy(pack: string) {
    setBuying(pack);
    const fd = new FormData();
    fd.set("pack", pack);
    const res = await createCheckoutAction({ ok: false }, fd);
    setBuying(null);
    if (res.ok && res.url) {
      window.location.href = res.url;
    } else {
      toast.error(res.error ?? "Checkout failed");
    }
  }

  if (!billing.billing_enabled) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Billing is not enabled on this deployment — you&apos;re running on
          your own API keys, and the only limits are the spend caps you set.
        </CardContent>
      </Card>
    );
  }

  const low = Number(billing.balance_usd) < 1;

  return (
    <div className="space-y-8">
      <Card>
        <CardContent className="space-y-1 pt-6">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Available credit
          </p>
          <p
            className={cn(
              "font-mono text-5xl font-semibold tabular-nums tracking-tight",
              low ? "text-brand" : "text-foreground",
            )}
          >
            {formatUsd(Number(billing.balance_usd))}
          </p>
          {low && (
            <p className="text-xs text-brand">
              Running low — the pipeline pauses at zero.
            </p>
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="text-lg font-semibold tracking-tight">Add credit</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {PACKS.map((p) => (
            <Card
              aria-disabled={buying !== null}
              className={cn(
                "cursor-pointer text-left transition-colors",
                p.featured
                  ? "border-brand/50 bg-brand/5 hover:bg-brand/10"
                  : "hover:border-brand/30",
                buying !== null && "pointer-events-none opacity-70",
              )}
              key={p.key}
              onClick={() => buy(p.key)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  buy(p.key);
                }
              }}
            >
              <CardContent className="flex flex-col items-start">
                <span className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  {p.label}
                </span>
                <span className="mt-2 font-mono text-3xl font-semibold tabular-nums">
                  ${p.amount}
                </span>
                <span className="mt-1 text-xs text-muted-foreground">{p.blurb}</span>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand">
                  {buying === p.key ? "Opening checkout…" : "Buy"}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {billing.transactions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">History</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {billing.transactions.map((tx) => {
                  const amt = Number(tx.amount_usd);
                  return (
                    <TableRow key={tx.id}>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {new Date(tx.created_at).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {tx.description || tx.kind}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono tabular-nums",
                          amt > 0 ? "text-success-foreground" : "text-muted-foreground",
                        )}
                      >
                        {amt > 0 ? "+" : ""}
                        {formatUsd(amt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
