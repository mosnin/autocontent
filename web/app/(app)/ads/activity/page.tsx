import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { hubCardClass } from "@/components/hub/primitives";
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

function tone(action: string): "destructive" | "warning" | "success" | "secondary" {
  if (action.includes("denied")) return "destructive";
  if (action.includes("approval") || action.includes("governance")) return "warning";
  if (action.includes("change") || action.includes("create")) return "success";
  return "secondary";
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
        <Card className={hubCardClass}>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <h3 className="text-lg font-semibold">No activity yet</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Every governance change, proposal, approval, and applied action
              will be recorded here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <Card className={cn(hubCardClass, "min-w-[720px]")}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead className="w-[160px]">Target</TableHead>
                  <TableHead className="w-[110px] text-right">Δ / day</TableHead>
                  <TableHead className="w-[120px]">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {actions.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Badge variant={tone(a.action)} className="font-mono">
                        {a.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {a.actor_email || a.actor}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      <span className="text-foreground">{a.target_type}</span>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {Number(a.dollar_delta_usd) !== 0
                        ? formatUsd(a.dollar_delta_usd)
                        : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
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
          </Card>
        </div>
      )}
    </div>
  );
}
