"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";

import { Button } from "@/components/square/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/square/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { formatUsd, formatUsdPrecise } from "@/lib/format";
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
  { key: "studio", label: "Scale", amount: 50, blurb: "Several channels" },
];

export function BillingClient({ initial }: { initial: BillingBalance }) {
  const { data } = useSWR<BillingBalance>("/api/v1/billing/balance", clientFetch, {
    refreshInterval: 15000,
    fallbackData: initial,
  });
  const billing = data ?? initial;
  const [buying, setBuying] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState<Pack | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  const { data: fullLedger } = useSWR<BillingBalance>(
    showAll ? "/api/v1/billing/balance?limit=500" : null,
    clientFetch,
  );

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
    try {
      const fd = new FormData();
      fd.set("pack", pack);
      const res = await createCheckoutAction({ ok: false }, fd);
      if (res.ok && res.url) {
        window.location.href = res.url;
      } else {
        toast.error(res.error ?? "Checkout failed");
      }
    } catch {
      toast.error("Checkout failed — try again");
    } finally {
      // Always release the buttons: a thrown action must not brick the page.
      setBuying(null);
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
              Running low — rendering pauses at zero.
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
              onClick={() => setConfirming(p)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setConfirming(p);
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

      <Dialog open={confirming !== null} onOpenChange={(v) => !v && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Buy ${confirming?.amount} of credit?
            </DialogTitle>
            <DialogDescription>
              You&apos;ll be taken to Stripe to pay ${confirming?.amount} once.
              The credit lands on your balance as soon as payment confirms.
              No subscription, no auto-renew.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              disabled={buying !== null}
              onClick={() => {
                if (confirming) void buy(confirming.key);
              }}
            >
              {buying ? "Opening checkout…" : "Continue to Stripe"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                {groupLedger(
                  (showAll && fullLedger ? fullLedger : billing).transactions,
                ).map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="align-top tabular-nums text-muted-foreground">
                      {new Date(row.when).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.detail ? (
                        <details>
                          <summary className="cursor-pointer select-none">
                            {row.what}
                          </summary>
                          <ul className="mt-1 space-y-0.5 font-mono text-xs text-muted-foreground">
                            {row.detail.map((d, i) => (
                              <li key={i} className="flex justify-between gap-4">
                                <span>{d.label}</span>
                                <span className="tabular-nums">{formatUsdPrecise(d.amount)}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : (
                        row.what
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right align-top font-mono tabular-nums",
                        row.amount > 0
                          ? "text-success-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {row.amount > 0 ? "+" : ""}
                      {formatUsdPrecise(row.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!showAll && billing.transactions.length >= 50 && (
              <div className="mt-3 text-center">
                <Button size="sm" variant="outline" onClick={() => setShowAll(true)}>
                  Show full history
                </Button>
              </div>
            )}
            {showAll && (fullLedger?.transactions.length ?? 0) >= 500 && (
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Showing the most recent 500 entries.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface LedgerRow {
  key: string;
  when: string;
  what: string;
  amount: number;
  detail?: { label: string; amount: number }[];
}

/**
 * Roll per-provider-call debits up into one row per video run (debits share
 * the run's id in `reference`), keeping purchases/grants as single rows.
 * The per-call detail stays one click away inside the row.
 */
function groupLedger(txs: BillingBalance["transactions"]): LedgerRow[] {
  const rows: LedgerRow[] = [];
  const groups = new Map<string, LedgerRow>();
  for (const tx of txs) {
    const amt = Number(tx.amount_usd);
    if (tx.kind === "debit" && tx.reference) {
      let g = groups.get(tx.reference);
      if (!g) {
        g = {
          key: `run-${tx.reference}`,
          when: tx.created_at,
          what: "",
          amount: 0,
          detail: [],
        };
        groups.set(tx.reference, g);
        rows.push(g);
      }
      g.amount += amt;
      g.detail!.push({ label: tx.description || tx.kind, amount: amt });
      g.what = `Video run · ${g.detail!.length} metered ${
        g.detail!.length === 1 ? "call" : "calls"
      }`;
      // newest timestamp wins so the row sorts where the run finished
      if (tx.created_at > g.when) g.when = tx.created_at;
    } else {
      rows.push({
        key: tx.id,
        when: tx.created_at,
        what: tx.description || tx.kind,
        amount: amt,
      });
    }
  }
  return rows;
}
