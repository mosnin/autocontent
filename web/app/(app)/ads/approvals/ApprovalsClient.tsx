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
import Link from "next/link";
import { adsKeys, decideApproval, type AdApproval } from "@/lib/ads-client";
import { adActionLabel } from "@/lib/labels";
import { toastActionError } from "@/lib/errors";

export function ApprovalsClient({
  initial,
  campaignNames = {},
  approvalThresholdUsd,
}: {
  initial: AdApproval[];
  /** campaign_id -> name, resolved server-side so rows can say what they govern. */
  campaignNames?: Record<string, string>;
  approvalThresholdUsd?: string;
}) {
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
      toastActionError(e instanceof Error ? e.message : undefined, "Couldn't record the decision");
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
          {approvalThresholdUsd && (
            <> Changes above {formatUsd(approvalThresholdUsd)} per day always stop here.</>
          )}
        </p>
      </div>

      {pending.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <h3 className="text-lg font-semibold">Nothing to review</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              When an agent proposes a budget change above your approval
              threshold{approvalThresholdUsd ? <> ({formatUsd(approvalThresholdUsd)}/day)</> : null},
              it shows up here for a one-click decision.
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
                        className="text-xs font-medium px-2 py-0.5 border text-muted-foreground bg-transparent"
                      >
                        {adActionLabel(a.action)}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-3 text-sm font-medium max-w-[360px]">
                      <span className="block truncate">{a.summary}</span>
                      {a.campaign_id && (
                        <Link
                          className="text-xs font-normal text-brand underline-offset-2 hover:underline"
                          href={`/ads/campaigns/${a.campaign_id}`}
                        >
                          {campaignNames[a.campaign_id] ?? "View campaign"}
                        </Link>
                      )}
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
