"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Bell, BellRing, Inbox } from "lucide-react";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ackAlert,
  alertsFetcher,
  analyticsKeys,
  humanizeAnalyticsError,
  type PerformanceAlert,
} from "@/lib/press-analytics-client";

const ALERT_KIND_LABEL: Record<string, string> = {
  competitor_activity: "Competitor activity",
  ranking_drop: "Ranking drop",
  cadence_slip: "Cadence slip",
  quality_drop: "Quality drop",
};

const SEVERITY_VARIANT: Record<string, BadgeVariant> = {
  info: "info",
  warn: "warning",
  critical: "destructive",
};

type KindFilter = "all" | keyof typeof ALERT_KIND_LABEL;
type SeverityFilter = "all" | "info" | "warn" | "critical";
type StateFilter = "unacknowledged" | "acknowledged" | "all";

export function AlertsClient({ initial }: { initial: PerformanceAlert[] }) {
  const { data, mutate } = useSWR<PerformanceAlert[]>(
    analyticsKeys.alerts(),
    alertsFetcher,
    { fallbackData: initial },
  );
  const alerts = data ?? [];

  const [kind, setKind] = React.useState<KindFilter>("all");
  const [severity, setSeverity] = React.useState<SeverityFilter>("all");
  const [state, setState] = React.useState<StateFilter>("unacknowledged");

  const kindsPresent = Array.from(new Set(alerts.map((a) => a.kind)));

  const filtered = alerts
    .filter((a) => kind === "all" || a.kind === kind)
    .filter((a) => severity === "all" || a.severity === severity)
    .filter((a) => {
      if (state === "all") return true;
      if (state === "acknowledged") return a.acknowledged_at !== null;
      return a.acknowledged_at === null;
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  async function handleAck(alert: PerformanceAlert) {
    const prev = alerts;
    void mutate(
      prev.map((a) =>
        a.id === alert.id ? { ...a, acknowledged_at: new Date().toISOString() } : a,
      ),
      false,
    );
    try {
      await ackAlert(alert.id);
      void mutate();
    } catch (err) {
      void mutate(prev, false);
      toast.error(humanizeAnalyticsError(err));
    }
  }

  const unacknowledgedCount = alerts.filter((a) => a.acknowledged_at === null).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          Everything the pipeline flagged: competitor activity, ranking
          drops, cadence slips, and quality drops, in one inbox.
          {unacknowledgedCount > 0 && ` ${unacknowledgedCount} unacknowledged.`}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Select value={state} onValueChange={(v) => setState(v as StateFilter)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unacknowledged">Unacknowledged</SelectItem>
            <SelectItem value="acknowledged">Acknowledged</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={(v) => setKind(v as KindFilter)}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every kind</SelectItem>
            {kindsPresent.map((k) => (
              <SelectItem key={k} value={k}>
                {ALERT_KIND_LABEL[k] ?? k}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={severity} onValueChange={(v) => setSeverity(v as SeverityFilter)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every severity</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="warn">Warning</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="rounded-full bg-muted p-3">
              {state === "unacknowledged" ? (
                <Inbox className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
              ) : (
                <BellRing className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
              )}
            </div>
            <h3 className="text-lg font-semibold">
              {alerts.length === 0 ? "No alerts yet" : "Nothing matches these filters"}
            </h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              {alerts.length === 0
                ? "Alerts show up here from competitor watch scans and the performance scan."
                : "Try a different kind, severity, or state."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <ul className="divide-y divide-border/60">
            {filtered.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-normal">
                      {ALERT_KIND_LABEL[a.kind] ?? a.kind}
                    </Badge>
                    <Badge variant={SEVERITY_VARIANT[a.severity] ?? "outline"}>
                      {a.severity}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(a.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm">{a.message}</p>
                </div>
                {a.acknowledged_at === null ? (
                  <Button size="sm" variant="outline" onClick={() => void handleAck(a)}>
                    <Bell className="h-3.5 w-3.5" aria-hidden="true" />
                    Acknowledge
                  </Button>
                ) : (
                  <Badge variant="secondary" className="font-normal">
                    Acknowledged
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
