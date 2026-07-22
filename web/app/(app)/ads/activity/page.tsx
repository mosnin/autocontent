// Square UI "marketing-dashboard" template table anatomy, applied to the
// read-only ads audit log. Same Table/TableRow/TableCell chrome as
// campaigns-table.tsx / QueueClient, template badge tone technique
// (Badge variant="outline" + a tonal class per action kind, since square
// Badge has no destructive/warning/success variants to reuse). No
// toolbar — this table never had search/filter and stays read-only.

import { Badge } from "@/components/square/ui/badge";
import { Card, CardContent } from "@/components/square/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/square/ui/table";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { formatUsd } from "@/lib/format";

export const dynamic = "force-dynamic";

interface AdAction {
  id: number;
  actor: string;
  actor_email: string;
  action: string;
  platform: string;
  target_type: string;
  target_id: string;
  dollar_delta_usd: string;
  created_at: string;
}

function toneClass(action: string): string {
  if (action.includes("denied"))
    return "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400 border-rose-200 dark:border-rose-900";
  if (action.includes("approval") || action.includes("governance"))
    return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-amber-200 dark:border-amber-900";
  if (action.includes("change") || action.includes("create"))
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900";
  return "border text-muted-foreground bg-transparent";
}

export default async function AdsActivityPage() {
  let actions: AdAction[] = [];
  try {
    actions = await api<AdAction[]>("/api/v1/ads/actions?limit=200");
  } catch {
    actions = [];
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="text-sm text-muted-foreground">
          Append-only log of every ads action — by agents and by you. This is
          the audit trail for spend.
        </p>
      </div>

      {actions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <h3 className="text-lg font-semibold">No activity yet</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Every governance change, proposal, approval, and applied action
              will be recorded here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border bg-card flex flex-col">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs font-medium text-muted-foreground h-10 whitespace-nowrap">
                    Action
                  </TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground h-10">
                    Actor
                  </TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground h-10 whitespace-nowrap">
                    Target
                  </TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground h-10 text-right whitespace-nowrap">
                    Δ / day
                  </TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground h-10 whitespace-nowrap">
                    When
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {actions.map((a) => (
                  <TableRow key={a.id} className="border-b last:border-0 hover:bg-muted/30">
                    <TableCell className="py-3 whitespace-nowrap">
                      <Badge
                        variant="outline"
                        className={cn(
                          "font-mono text-xs font-medium px-2 py-0.5",
                          toneClass(a.action),
                        )}
                      >
                        {a.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-3 text-sm text-muted-foreground whitespace-nowrap">
                      {a.actor_email || a.actor}
                    </TableCell>
                    <TableCell className="py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                      <span className="text-foreground">{a.target_type}</span>
                    </TableCell>
                    <TableCell className="py-3 text-right font-mono text-sm tabular-nums whitespace-nowrap">
                      {Number(a.dollar_delta_usd) !== 0
                        ? formatUsd(a.dollar_delta_usd)
                        : "—"}
                    </TableCell>
                    <TableCell className="py-3 tabular-nums text-sm text-muted-foreground whitespace-nowrap">
                      {new Date(a.created_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
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
