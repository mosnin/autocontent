"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { ArrowLeft, Pause, Play, Square } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clientFetch } from "@/lib/client-fetcher";
import { formatUsd } from "@/lib/format";
import {
  adsKeys,
  changeBudget,
  changeCampaignStatus,
  type AdCampaign,
  type AdMetricsDaily,
} from "@/lib/ads-client";
import { statusVariant } from "../CampaignsClient";

interface Detail {
  campaign: AdCampaign;
  metrics: AdMetricsDaily[];
}

export function CampaignDetailClient({ initial }: { initial: Detail }) {
  const id = initial.campaign.id;
  const { data, mutate } = useSWR<Detail>(adsKeys.campaign(id), clientFetch, {
    fallbackData: initial,
    refreshInterval: 30_000,
  });
  const campaign = data?.campaign ?? initial.campaign;
  const metrics = data?.metrics ?? [];

  const [budget, setBudget] = React.useState(
    campaign.daily_budget_usd ?? "",
  );
  const [busy, setBusy] = React.useState<string | null>(null);

  const totals = metrics.reduce(
    (acc, m) => ({
      spend: acc.spend + Number(m.spend_usd),
      revenue: acc.revenue + Number(m.revenue_usd),
      clicks: acc.clicks + m.clicks,
      impressions: acc.impressions + m.impressions,
    }),
    { spend: 0, revenue: 0, clicks: 0, impressions: 0 },
  );
  const roas = totals.spend > 0 ? totals.revenue / totals.spend : null;

  async function onBudget(e: React.FormEvent) {
    e.preventDefault();
    setBusy("budget");
    try {
      const res = await changeBudget(id, budget || "0");
      if (res.status === "pending_approval") {
        toast.message("Budget change needs approval. Sent to your inbox.");
      } else {
        toast.success("Budget updated");
      }
      void mutate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast.error(msg.includes("402") ? msg.replace(/^402\s*/, "") : msg);
    } finally {
      setBusy(null);
    }
  }

  async function onStatus(status: "active" | "paused" | "ended") {
    setBusy(status);
    try {
      await changeCampaignStatus(id, status);
      toast.success(`Campaign ${status}`);
      void mutate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast.error(msg.includes("402") ? msg.replace(/^402\s*/, "") : msg);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <Link
        href="/ads/campaigns"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Campaigns
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {campaign.name}
            </h1>
            <Badge variant={statusVariant(campaign.status)}>
              {campaign.status}
            </Badge>
          </div>
          <p className="text-sm capitalize text-muted-foreground">
            {campaign.objective || "no objective"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {campaign.status !== "active" && campaign.status !== "ended" && (
            <Button
              size="sm"
              onClick={() => onStatus("active")}
              disabled={busy !== null}
              isLoading={busy === "active"}
            >
              <Play className="size-3.5" aria-hidden />
              Activate
            </Button>
          )}
          {campaign.status === "active" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onStatus("paused")}
              disabled={busy !== null}
              isLoading={busy === "paused"}
            >
              <Pause className="size-3.5" aria-hidden />
              Pause
            </Button>
          )}
          {campaign.status !== "ended" && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => onStatus("ended")}
              disabled={busy !== null}
              isLoading={busy === "ended"}
            >
              <Square className="size-3.5" aria-hidden />
              End
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Spend" value={formatUsd(totals.spend)} />
        <Stat
          label="ROAS"
          value={roas === null ? "-" : `${roas.toFixed(2)}×`}
        />
        <Stat label="Clicks" value={totals.clicks.toLocaleString()} />
        <Stat label="Impressions" value={totals.impressions.toLocaleString()} />
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={onBudget} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="daily-budget">Daily budget</Label>
              <div className="relative w-40">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  id="daily-budget"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  className="pl-6 font-mono tabular-nums"
                />
              </div>
            </div>
            <Button type="submit" disabled={busy !== null} isLoading={busy === "budget"}>
              Update budget
            </Button>
            <p className="w-full text-xs text-muted-foreground">
              Large increases are held for approval; changes over your account
              caps or with the kill-switch on are refused.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-1 pt-5">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="font-mono text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}
