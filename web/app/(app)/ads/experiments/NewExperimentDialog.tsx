"use client";

// Create-experiment dialog: campaign picker, kind select, and a per-kind
// config form. creative_ab picks 2-4 existing creatives off the chosen
// campaign; budget_ramp asks for a target daily budget, a step percentage
// (capped at 20%), and an interval in days. Mirrors NewCampaignClient's
// form conventions (Card-free, plain labeled fields inside a Dialog).

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { clientFetch } from "@/lib/client-fetcher";
import {
  adsKeys,
  createExperiment,
  type AdCampaign,
  type AdCreative,
  type AdExperiment,
  type BudgetRampConfig,
  type CreativeAbConfig,
  type ExperimentKind,
} from "@/lib/ads-client";
import { describeAdsError } from "@/lib/ads-format";

const MIN_ARMS = 2;
const MAX_ARMS = 4;
const MAX_STEP_PCT = 20;

export function NewExperimentDialog({
  open,
  onOpenChange,
  campaigns,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  campaigns: AdCampaign[];
  onCreated: (experiment: AdExperiment) => void;
}) {
  const [campaignId, setCampaignId] = React.useState(campaigns[0]?.id ?? "");
  const [kind, setKind] = React.useState<ExperimentKind>("creative_ab");
  const [creativeIds, setCreativeIds] = React.useState<string[]>([]);
  const [windowDays, setWindowDays] = React.useState("7");
  const [targetDaily, setTargetDaily] = React.useState("");
  const [stepPct, setStepPct] = React.useState("10");
  const [intervalDays, setIntervalDays] = React.useState("3");
  const [busy, setBusy] = React.useState(false);

  // Reset per-open so a previous draft never leaks into the next dialog.
  React.useEffect(() => {
    if (open) {
      setCampaignId(campaigns[0]?.id ?? "");
      setKind("creative_ab");
      setCreativeIds([]);
      setWindowDays("7");
      setTargetDaily("");
      setStepPct("10");
      setIntervalDays("3");
    }
  }, [open, campaigns]);

  const { data: creatives } = useSWR<AdCreative[]>(
    open && kind === "creative_ab" && campaignId ? adsKeys.creatives(campaignId) : null,
    clientFetch,
  );

  function toggleCreative(id: string) {
    setCreativeIds((prev) => {
      if (prev.includes(id)) return prev.filter((c) => c !== id);
      if (prev.length >= MAX_ARMS) return prev;
      return [...prev, id];
    });
  }

  const windowDaysNum = Number(windowDays);
  const targetDailyNum = Number(targetDaily);
  const stepPctNum = Number(stepPct);
  const intervalDaysNum = Number(intervalDays);

  const creativeAbValid =
    creativeIds.length >= MIN_ARMS &&
    creativeIds.length <= MAX_ARMS &&
    Number.isInteger(windowDaysNum) &&
    windowDaysNum >= 1;

  const budgetRampValid =
    targetDailyNum > 0 &&
    stepPctNum > 0 &&
    stepPctNum <= MAX_STEP_PCT &&
    Number.isInteger(intervalDaysNum) &&
    intervalDaysNum >= 1;

  const canSubmit =
    !!campaignId && (kind === "creative_ab" ? creativeAbValid : budgetRampValid);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const config: CreativeAbConfig | BudgetRampConfig =
        kind === "creative_ab"
          ? { creative_ids: creativeIds, window_days: windowDaysNum }
          : {
              target_daily_usd: targetDaily,
              step_pct: stepPct,
              interval_days: intervalDaysNum,
            };
      const experiment = await createExperiment({ campaign_id: campaignId, kind, config });
      toast.success("Experiment created as a draft");
      onCreated(experiment);
      onOpenChange(false);
    } catch (err) {
      toast.error(describeAdsError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New experiment</DialogTitle>
          <DialogDescription>
            Creates a draft. Nothing runs until you start it, and every
            spend-affecting step still passes your budget guardrails.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="exp-campaign">Campaign</Label>
            <Select value={campaignId} onValueChange={setCampaignId} disabled={campaigns.length === 0}>
              <SelectTrigger id="exp-campaign" className="w-full">
                <SelectValue placeholder="Select a campaign" />
              </SelectTrigger>
              <SelectContent>
                {campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="exp-kind">Kind</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as ExperimentKind)}>
              <SelectTrigger id="exp-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="creative_ab">Creative A/B test</SelectItem>
                <SelectItem value="budget_ramp">Budget ramp</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {kind === "creative_ab" ? (
            <div className="space-y-3 rounded-lg border border-border/60 p-3">
              <div className="space-y-1.5">
                <p className="text-sm font-medium">
                  Creatives ({creativeIds.length}/{MAX_ARMS})
                </p>
                <p className="text-xs text-muted-foreground">
                  Pick {MIN_ARMS}-{MAX_ARMS} creatives on this campaign.
                </p>
              </div>
              {!campaignId ? (
                <p className="text-sm text-muted-foreground">Pick a campaign first.</p>
              ) : creatives === undefined ? (
                <p className="text-sm text-muted-foreground">Loading creatives…</p>
              ) : creatives.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No creatives on this campaign yet. Generate some in Creative
                  studio first.
                </p>
              ) : (
                <ul className="max-h-48 space-y-1.5 overflow-y-auto">
                  {creatives.map((cr) => {
                    const checked = creativeIds.includes(cr.id);
                    const disabled = !checked && creativeIds.length >= MAX_ARMS;
                    return (
                      <li key={cr.id}>
                        <label
                          className={`flex cursor-pointer items-start gap-2 rounded-md p-1.5 text-sm ${
                            disabled ? "cursor-not-allowed opacity-50" : "hover:bg-accent"
                          }`}
                        >
                          <Checkbox
                            checked={checked}
                            disabled={disabled}
                            className="mt-0.5"
                            onCheckedChange={() => toggleCreative(cr.id)}
                          />
                          <span className="truncate">{cr.headline || cr.id.slice(0, 8)}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="exp-window">Window (days per arm)</Label>
                <Input
                  id="exp-window"
                  type="number"
                  min="1"
                  step="1"
                  value={windowDays}
                  onChange={(e) => setWindowDays(e.target.value)}
                  className="w-28 font-mono tabular-nums"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border border-border/60 p-3">
              <div className="space-y-1.5">
                <Label htmlFor="exp-target">Target daily budget</Label>
                <div className="relative w-40">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="exp-target"
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    value={targetDaily}
                    onChange={(e) => setTargetDaily(e.target.value)}
                    className="pl-6 font-mono tabular-nums"
                    placeholder="50.00"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="exp-step">Step (max {MAX_STEP_PCT}%)</Label>
                  <div className="relative w-24">
                    <Input
                      id="exp-step"
                      type="number"
                      min="0.1"
                      max={MAX_STEP_PCT}
                      step="0.1"
                      value={stepPct}
                      onChange={(e) => setStepPct(e.target.value)}
                      className="pr-6 font-mono tabular-nums"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      %
                    </span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="exp-interval">Every (days)</Label>
                  <Input
                    id="exp-interval"
                    type="number"
                    min="1"
                    step="1"
                    value={intervalDays}
                    onChange={(e) => setIntervalDays(e.target.value)}
                    className="w-24 font-mono tabular-nums"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Each step moves at most {stepPct || MAX_STEP_PCT}% of the
                current daily budget toward the target, and still passes your
                spend guard and approval threshold.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || busy} isLoading={busy}>
              Create draft
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
