"use client";

// One experiment: config summary, status, arms (for creative_ab, fetched
// lazily since the list endpoint doesn't include them), and the action set
// valid for its current kind/status. Every action failure is humanized via
// describeAdsError, consistent with the rest of /ads.

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Play, RefreshCw, Trophy, X } from "lucide-react";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { clientFetch } from "@/lib/client-fetcher";
import { formatUsd } from "@/lib/format";
import {
  adsKeys,
  advanceExperiment,
  cancelExperiment,
  evaluateExperiment,
  startExperiment,
  type AdCampaign,
  type AdExperiment,
  type AdExperimentDetail,
} from "@/lib/ads-client";
import { adStatusLabel, describeAdsError } from "@/lib/ads-format";

function kindLabel(kind: string): string {
  if (kind === "creative_ab") return "Creative A/B test";
  if (kind === "budget_ramp") return "Budget ramp";
  return kind;
}

// adStatusLabel/adStatusVariant (ads-format.ts) are tuned for account/
// campaign statuses; experiments have their own status vocabulary
// (draft/running/completed/cancelled), so the label falls back to
// ads-format's titleCase for anything it doesn't already know, and the
// tone mapping lives here rather than editing the shared, read-only file.
function experimentStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case "running":
      return "info";
    case "completed":
      return "success";
    case "cancelled":
      return "destructive";
    case "draft":
      return "secondary";
    default:
      return "outline";
  }
}

function configSummary(experiment: AdExperiment): string {
  if (experiment.kind === "creative_ab") {
    const n = experiment.config.creative_ids?.length ?? 0;
    const days = experiment.config.window_days ?? 7;
    return `${n} creative${n === 1 ? "" : "s"} · ${days}-day window per arm`;
  }
  if (experiment.kind === "budget_ramp") {
    const target = experiment.config.target_daily_usd;
    const step = experiment.config.step_pct;
    const interval = experiment.config.interval_days;
    return `Target ${target ? formatUsd(target) : "?"}/day · step ${step ?? "?"}% every ${interval ?? "?"}d`;
  }
  return "";
}

export function ExperimentCard({
  experiment,
  campaign,
  onChanged,
}: {
  experiment: AdExperiment;
  campaign: AdCampaign | undefined;
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);

  const isCreativeAb = experiment.kind === "creative_ab";
  const { data: detail } = useSWR<AdExperimentDetail>(
    isCreativeAb ? adsKeys.experiment(experiment.id) : null,
    clientFetch,
    { refreshInterval: experiment.status === "running" ? 20_000 : 0 },
  );

  async function run(action: string, fn: () => Promise<AdExperiment>, successMsg: string) {
    setBusy(action);
    try {
      await fn();
      toast.success(successMsg);
      onChanged();
    } catch (err) {
      toast.error(describeAdsError(err));
    } finally {
      setBusy(null);
    }
  }

  const safetyPaused = Boolean(experiment.result.safety_paused);
  const winnerArmId = experiment.result.winner_arm_id as string | undefined;
  const stepsCount = Array.isArray(experiment.result.steps)
    ? (experiment.result.steps as unknown[]).length
    : 0;
  const pendingApproval = Boolean(experiment.result.pending_approval_id);

  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold leading-snug">
              {campaign?.name ?? experiment.campaign_id.slice(0, 8)}
            </p>
            <p className="text-xs text-muted-foreground">{kindLabel(experiment.kind)}</p>
          </div>
          <Badge variant={experimentStatusVariant(experiment.status)}>
            {adStatusLabel(experiment.status)}
          </Badge>
        </div>

        <p className="text-sm text-muted-foreground">{configSummary(experiment)}</p>

        {isCreativeAb && (
          <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            Arm attribution is approximate until per-creative platform metrics
            sync. See each arm&apos;s day count below.
          </p>
        )}

        {safetyPaused && (
          <Badge variant="warning" className="w-fit">
            Safety-paused: aggregate ROAS fell below the catastrophic floor
          </Badge>
        )}
        {pendingApproval && (
          <Badge variant="info" className="w-fit">
            Awaiting approval on the next step
          </Badge>
        )}
        {experiment.kind === "budget_ramp" && stepsCount > 0 && (
          <p className="text-xs text-muted-foreground">{stepsCount} step{stepsCount === 1 ? "" : "s"} applied</p>
        )}

        {isCreativeAb && detail && detail.arms.length > 0 && (
          <ul className="space-y-1.5 border-t border-border/60 pt-3">
            {detail.arms.map((arm) => (
              <li key={arm.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5 truncate">
                  {(arm.is_winner || arm.id === winnerArmId) && (
                    <Trophy className="size-3 text-warning" aria-hidden />
                  )}
                  <span className="truncate">{arm.label || arm.id.slice(0, 8)}</span>
                </span>
                <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                  {arm.metrics.days_attributed ?? 0}d ·{" "}
                  {arm.metrics.spend_usd ? formatUsd(arm.metrics.spend_usd) : "$0.00"}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
          {experiment.status === "draft" && (
            <Button
              size="sm"
              onClick={() => run("start", () => startExperiment(experiment.id), "Experiment started")}
              disabled={busy !== null}
              isLoading={busy === "start"}
            >
              <Play className="size-3.5" aria-hidden />
              Start
            </Button>
          )}
          {experiment.status === "running" && experiment.kind === "budget_ramp" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => run("advance", () => advanceExperiment(experiment.id), "Ramp advanced")}
              disabled={busy !== null}
              isLoading={busy === "advance"}
            >
              <RefreshCw className="size-3.5" aria-hidden />
              Advance
            </Button>
          )}
          {experiment.status === "running" && experiment.kind === "creative_ab" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => run("evaluate", () => evaluateExperiment(experiment.id), "Evaluated")}
              disabled={busy !== null}
              isLoading={busy === "evaluate"}
            >
              <RefreshCw className="size-3.5" aria-hidden />
              Evaluate
            </Button>
          )}
          {experiment.status !== "completed" && experiment.status !== "cancelled" && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => run("cancel", () => cancelExperiment(experiment.id), "Experiment cancelled")}
              disabled={busy !== null}
              isLoading={busy === "cancel"}
            >
              <X className="size-3.5" aria-hidden />
              Cancel
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
