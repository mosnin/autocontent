"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  Bell,
  BellOff,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Plus,
  RadioTower,
  Trash2,
  Users,
} from "lucide-react";

import { useConfirm } from "@/components/confirm-dialog";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ackAlert,
  analyticsKeys,
  competitorArticlesFetcher,
  competitorsFetcher,
  createCompetitor,
  deleteCompetitor,
  humanizeAnalyticsError,
  runCompetitorWatch,
  alertsFetcher,
  type Competitor,
  type PerformanceAlert,
} from "@/lib/press-analytics-client";
import type { Niche } from "@/lib/types";
import { cn } from "@/lib/utils";

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

export function CompetitorsClient({
  initialCompetitors,
  initialAlerts,
  niches,
}: {
  initialCompetitors: Competitor[];
  initialAlerts: PerformanceAlert[];
  niches: Niche[];
}) {
  const active = niches.filter((n) => !n.archived_at);
  const nicheTitles = React.useMemo(
    () => new Map(niches.map((n) => [n.id, n.title])),
    [niches],
  );

  const { data, mutate } = useSWR<Competitor[]>(
    analyticsKeys.competitors(),
    competitorsFetcher,
    { fallbackData: initialCompetitors },
  );
  const competitors = (data ?? []).slice().sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const {
    data: alertsData,
    mutate: mutateAlerts,
  } = useSWR<PerformanceAlert[]>(
    analyticsKeys.alerts(false),
    alertsFetcher,
    { fallbackData: initialAlerts },
  );
  const alerts = alertsData ?? [];

  const [domain, setDomain] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [nicheId, setNicheId] = React.useState<string>("none");
  const [adding, setAdding] = React.useState(false);
  const [watching, setWatching] = React.useState(false);
  const confirm = useConfirm();

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!domain.trim()) {
      toast.error("Enter a domain");
      return;
    }
    setAdding(true);
    try {
      await createCompetitor({
        domain: domain.trim(),
        label: label.trim() || undefined,
        niche_id: nicheId === "none" ? undefined : nicheId,
      });
      toast.success("Competitor added");
      setDomain("");
      setLabel("");
      setNicheId("none");
      void mutate();
    } catch (err) {
      toast.error(humanizeAnalyticsError(err));
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(c: Competitor) {
    const ok = await confirm({
      title: `Stop tracking ${c.domain}?`,
      description: "Its stored article history is removed too. This can't be undone.",
      confirmText: "Stop tracking",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteCompetitor(c.id);
      toast.success("Competitor removed");
      void mutate();
    } catch (err) {
      toast.error(humanizeAnalyticsError(err));
    }
  }

  async function handleRunWatch() {
    setWatching(true);
    try {
      const result = await runCompetitorWatch();
      if (result.skipped) {
        toast.info("Competitor watch is disabled for this deployment");
      } else {
        toast.success(
          `Scanned ${result.competitors_scanned ?? 0} competitor${(result.competitors_scanned ?? 0) === 1 ? "" : "s"}, found ${result.found ?? 0} new article${(result.found ?? 0) === 1 ? "" : "s"}, raised ${result.alerts_raised ?? 0} alert${(result.alerts_raised ?? 0) === 1 ? "" : "s"}`,
        );
      }
      void mutate();
      void mutateAlerts();
    } catch (err) {
      toast.error(humanizeAnalyticsError(err));
    } finally {
      setWatching(false);
    }
  }

  async function handleAck(alert: PerformanceAlert) {
    const prev = alerts;
    void mutateAlerts(
      prev.filter((a) => a.id !== alert.id),
      false,
    );
    try {
      await ackAlert(alert.id);
    } catch (err) {
      void mutateAlerts(prev, false);
      toast.error(humanizeAnalyticsError(err));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Competitors</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Track competitor domains and get alerted when they publish
            something in your channels&apos; focus areas.
          </p>
        </div>
        <Button variant="outline" onClick={() => void handleRunWatch()} disabled={watching} isLoading={watching}>
          <RadioTower className="h-4 w-4" aria-hidden="true" />
          Run watch
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-[2] space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Domain</Label>
              <Input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="competitor.com"
              />
            </div>
            <div className="min-w-[160px] flex-1 space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Label (optional)</Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Main blog"
                maxLength={200}
              />
            </div>
            <div className="min-w-[180px] flex-1 space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Channel (optional)</Label>
              <Select value={nicheId} onValueChange={setNicheId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No channel</SelectItem>
                  {active.map((n) => (
                    <SelectItem key={n.id} value={n.id}>
                      {n.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={adding} isLoading={adding}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add competitor
            </Button>
          </form>
        </CardContent>
      </Card>

      {competitors.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="rounded-full bg-muted p-3">
              <Users className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold">No competitors tracked</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Add a domain above to start watching what they publish.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {competitors.map((c) => (
            <CompetitorCard
              key={c.id}
              competitor={c}
              nicheTitle={c.niche_id ? nicheTitles.get(c.niche_id) : undefined}
              onDelete={() => void handleDelete(c)}
            />
          ))}
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Alerts</h2>
          <span className="text-xs text-muted-foreground">
            {alerts.length} unacknowledged
          </span>
        </div>
        {alerts.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <BellOff className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">No unacknowledged alerts.</p>
            </CardContent>
          </Card>
        ) : (
          <Card className="gap-0 overflow-hidden py-0">
            <ul className="divide-y divide-border/60">
              {alerts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="font-normal">
                        {ALERT_KIND_LABEL[a.kind] ?? a.kind}
                      </Badge>
                      <Badge variant={SEVERITY_VARIANT[a.severity] ?? "outline"}>
                        {a.severity}
                      </Badge>
                    </div>
                    <p className="text-sm">{a.message}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => void handleAck(a)}>
                    <Bell className="h-3.5 w-3.5" aria-hidden="true" />
                    Acknowledge
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}

function CompetitorCard({
  competitor,
  nicheTitle,
  onDelete,
}: {
  competitor: Competitor;
  nicheTitle: string | undefined;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const { data, error, isLoading } = useSWR(
    expanded ? analyticsKeys.competitorArticles(competitor.id) : null,
    competitorArticlesFetcher,
  );

  return (
    <Card className="gap-0 py-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium">
                {competitor.label || competitor.domain}
              </span>
              {competitor.label && (
                <span className="truncate text-xs text-muted-foreground">
                  {competitor.domain}
                </span>
              )}
            </div>
            {nicheTitle && (
              <p className="text-xs text-muted-foreground">{nicheTitle}</p>
            )}
          </div>
        </button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          aria-label={`Stop tracking ${competitor.domain}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      {expanded && (
        <div className="border-t border-border/60 bg-muted/20 p-4">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : error ? (
            <p className="text-sm text-muted-foreground">
              {humanizeAnalyticsError(error)}
            </p>
          ) : !data || data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No articles seen yet. Run a watch scan to check for new ones.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.map((article) => (
                <li key={article.id} className="flex items-baseline justify-between gap-3">
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      "min-w-0 truncate text-sm font-medium text-brand hover:underline",
                    )}
                  >
                    {article.title || article.url}
                    <ExternalLink className="ml-1 inline h-3 w-3" aria-hidden="true" />
                  </a>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(article.first_seen).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
