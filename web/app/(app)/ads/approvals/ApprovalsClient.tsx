"use client";

// Square UI "marketing-dashboard" template table anatomy, applied to the
// approvals queue: real fields (action, summary, requested by, $/day
// delta) are tabular, so this follows the table precedent (queue's
// QueueClient / campaigns-table.tsx) rather than freeform cards — same
// Table/TableRow/TableCell chrome, template badge tone for the action
// chip, and an actions column with the real Approve/Reject buttons (same
// pattern as QueueClient's per-row actions). No toolbar: this list is
// already server-filtered to pending-only, same as before.

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";

import { Badge } from "@/components/square/ui/badge";
import { Button } from "@/components/square/ui/button";
import { Card, CardContent } from "@/components/square/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/square/ui/table";
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
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <h3 className="text-lg font-semibold">Nothing to review</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              When an agent proposes a budget change above your approval
              threshold, it shows up here for a one-click decision.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border bg-card flex flex-col">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs font-medium text-muted-foreground h-10">
                    Action
                  </TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground h-10">
                    Summary
                  </TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground h-10">
                    Requested by
                  </TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground h-10 text-right">
                    Δ / day
                  </TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground h-10 text-right">
                    Decision
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((a) => (
                  <TableRow key={a.id} className="border-b last:border-0 hover:bg-muted/30">
                    <TableCell className="py-3 whitespace-nowrap">
                      <Badge
                        variant="outline"
                        className="font-mono text-xs font-medium px-2 py-0.5 border text-muted-foreground bg-transparent"
                      >
                        {a.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-3 text-sm font-medium max-w-[320px] truncate">
                      {a.summary}
                    </TableCell>
                    <TableCell className="py-3 text-sm text-muted-foreground whitespace-nowrap">
                      {a.requested_by}
                    </TableCell>
                    <TableCell className="py-3 text-right font-mono text-sm tabular-nums text-amber-700 dark:text-amber-400 whitespace-nowrap">
                      {formatUsd(a.dollar_delta_usd)}
                    </TableCell>
                    <TableCell className="py-3 whitespace-nowrap">
                      <span className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          disabled={busy === a.id}
                          onClick={() => decide(a.id, "rejected")}
                        >
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          disabled={busy === a.id}
                          onClick={() => decide(a.id, "approved")}
                        >
                          {busy === a.id ? "…" : "Approve"}
                        </Button>
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
