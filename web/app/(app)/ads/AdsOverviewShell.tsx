"use client";

import Link from "next/link";
import { DollarSign, Megaphone, ShieldCheck, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/square/ui/card";
import { DashHeading, DashPanel } from "@/components/hub/dashboard-kit";
import { SquareStatsCards, type SquareStat } from "@/components/square/stats-cards";
import { formatUsd } from "@/lib/format";
import type { AdsOverview } from "@/lib/ads-client";

export function AdsOverviewShell({ ov }: { ov: AdsOverview | null }) {
  const hasAccounts = (ov?.accounts ?? 0) > 0;

  return (
    <div className="space-y-10">
      <DashHeading
        as="h1"
        sub="Create, manage, and scale paid campaigns across Google and Meta — driven by agents, governed by hard budget guardrails."
      >
        Bring any campaign to market
      </DashHeading>

      <DashPanel delay={0.12} title="Today">
        {hasAccounts && ov ? (
          <SquareStatsCards stats={buildStats(ov)} />
        ) : (
          <ConnectCallout />
        )}
      </DashPanel>

      <DashPanel delay={0.14} title="How it runs">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Feature
            title="Agent-run campaigns"
            body="Agents draft, launch, and iterate on campaigns using your brand kit and existing content."
          />
          <Feature
            title="Durable optimization"
            body="Metrics sync, budget scaling, and creative rotation run as durable background workflows."
          />
          <Feature
            title="Spend, governed"
            body="Every spend-affecting change passes a fail-closed budget guard, an approval gate, and an audit log."
          />
        </div>
      </DashPanel>
    </div>
  );
}

/**
 * Real-derivable KPI values only. Spend today's trend compares against the
 * 30-day average daily spend (both real numbers); accounts/campaigns show
 * their real totals with no arrow (no meaningful up/down direction for a
 * plain count); pending approvals gets the destructive-tone arrow when
 * there's something to review, since that IS the real state — never an
 * invented percentage.
 */
function buildStats(ov: AdsOverview): SquareStat[] {
  const spendToday = Number(ov.spend_today_usd);
  const spend30d = Number(ov.spend_30d_usd);
  const avgDaily30d = spend30d / 30;

  let spendDelta: SquareStat["delta"] = null;
  if (Number.isFinite(avgDaily30d) && avgDaily30d > 0) {
    const pct = ((spendToday - avgDaily30d) / avgDaily30d) * 100;
    spendDelta = {
      text: `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}% vs 30d avg`,
      trend: pct >= 0 ? "up" : "down",
    };
  }

  return [
    {
      key: "spend_today",
      label: "Spend today",
      icon: DollarSign,
      value: formatUsd(ov.spend_today_usd),
      delta: spendDelta,
    },
    {
      key: "active_accounts",
      label: "Active accounts",
      icon: Users,
      value: String(ov.active_accounts),
      delta: { text: `${ov.accounts} total` },
    },
    {
      key: "pending_approvals",
      label: "Pending approvals",
      icon: ShieldCheck,
      value: String(ov.pending_approvals),
      delta:
        ov.pending_approvals > 0
          ? { text: "needs your review", trend: "down" }
          : { text: "all clear" },
    },
    {
      key: "campaigns",
      label: "Campaigns",
      icon: Megaphone,
      value: String(ov.campaigns),
      delta: { text: `${ov.active_campaigns} active` },
    },
  ];
}

function ConnectCallout() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
        <h2 className="text-lg font-semibold">Connect an ad account to begin</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Link Google Ads or Meta Ads. Connecting only grants access — nothing
          can spend until you set a budget and approve it.
        </p>
        <Button asChild>
          <Link href="/ads/connect">Connect an account</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function Feature({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-2 pt-5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}
