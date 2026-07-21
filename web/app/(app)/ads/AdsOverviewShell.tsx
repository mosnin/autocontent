"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DashHeading, DashPanel } from "@/components/hub/dashboard-kit";
import { hubCardClass } from "@/components/hub/primitives";
import { cn } from "@/lib/utils";
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Spend today"
              value={formatUsd(ov.spend_today_usd)}
              foot={`${ov.active_accounts} active account${ov.active_accounts === 1 ? "" : "s"}`}
            />
            <Kpi
              label="Spend · 30d"
              value={formatUsd(ov.spend_30d_usd)}
              foot="last 30 days"
            />
            <Kpi
              label="Active campaigns"
              value={String(ov.active_campaigns)}
              foot={`${ov.campaigns} total`}
            />
            <Kpi
              label="Pending approvals"
              value={String(ov.pending_approvals)}
              foot={ov.pending_approvals > 0 ? "needs your review" : "all clear"}
              tone={ov.pending_approvals > 0 ? "warn" : undefined}
            />
          </div>
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

function ConnectCallout() {
  return (
    <Card className={cn(hubCardClass, "border-dashed")}>
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

function Kpi({
  label,
  value,
  foot,
  tone,
}: {
  label: string;
  value: string;
  foot: string;
  tone?: "warn";
}) {
  return (
    <Card className={hubCardClass}>
      <CardContent className="space-y-3 pt-5">
        <div className="text-sm font-medium text-muted-foreground">
          {label}
        </div>
        <p
          className={
            "font-mono text-3xl font-semibold tabular-nums tracking-tight" +
            (tone === "warn" ? " text-warning" : "")
          }
        >
          {value}
        </p>
        <div className="border-t border-border/60 pt-3 text-xs text-muted-foreground">
          {foot}
        </div>
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
    <Card className={hubCardClass}>
      <CardContent className="space-y-2 pt-5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}
