"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Check, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { hubCardClass } from "@/components/hub/primitives";
import { clientFetch } from "@/lib/client-fetcher";
import { formatUsd } from "@/lib/format";
import { adsKeys, decideApproval, type AdApproval } from "@/lib/ads-client";

export function ApprovalsClient({ initial }: { initial: AdApproval[] }) {
  const { data, mutate } = useSWR<AdApproval[]>(
    adsKeys.approvals("pending"),
    clientFetch,
    { fallbackData: initial, refreshInterval: 20_000 },
  );
  const pending = data ?? [];
  const [busy, setBusy] = React.useState<string | null>(null);

  async function decide(id: string, decision: "approved" | "rejected") {
    setBusy(id);
    try {
      await decideApproval(id, decision);
      toast.success(decision === "approved" ? "Approved" : "Rejected");
      void mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
        <p className="text-sm text-muted-foreground">
          Spend-affecting changes proposed by agents wait here. Nothing is
          applied to a platform until you approve it.
        </p>
      </div>

      {pending.length === 0 ? (
        <Card className={hubCardClass}>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <h3 className="text-lg font-semibold">Nothing to review</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              When an agent proposes a budget change above your approval
              threshold, it shows up here for a one-click decision.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {pending.map((a) => (
            <li key={a.id}>
              <Card className={hubCardClass}>
                <CardContent className="flex flex-wrap items-center gap-3 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="font-mono">
                        {a.action}
                      </Badge>
                      <span className="text-sm font-medium">{a.summary}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Requested by {a.requested_by} ·{" "}
                      <span className="font-mono tabular-nums text-warning">
                        {formatUsd(a.dollar_delta_usd)}/day
                      </span>{" "}
                      change
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === a.id}
                      onClick={() => decide(a.id, "rejected")}
                    >
                      <X className="size-3.5" aria-hidden />
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy === a.id}
                      isLoading={busy === a.id}
                      onClick={() => decide(a.id, "approved")}
                    >
                      <Check className="size-3.5" aria-hidden />
                      Approve
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
