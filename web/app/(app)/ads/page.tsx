import Link from "next/link";
import {
  BarChart3,
  CheckSquare,
  DollarSign,
  Megaphone,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";

import { AppIcon } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import type { AdsOverview } from "@/lib/ads-client";

export const dynamic = "force-dynamic";

export default async function AdsOverviewPage() {
  let ov: AdsOverview | null = null;
  try {
    ov = await api<AdsOverview>("/api/v1/ads/overview");
  } catch {
    ov = null;
  }

  const hasAccounts = (ov?.accounts ?? 0) > 0;
  const noSpendSynced =
    hasAccounts &&
    ov !== null &&
    Number(ov.spend_today_usd) === 0 &&
    Number(ov.spend_30d_usd) === 0 &&
    ov.campaigns > 0;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2.5">
            <AppIcon color="orange">
              <Megaphone />
            </AppIcon>
            <h1 className="text-2xl font-semibold tracking-tight">Ads</h1>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Create, manage, and scale paid campaigns across Google and Meta,
            driven by agents, governed by hard budget guardrails.
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/ads/connect">Ad accounts</Link>
        </Button>
      </header>

      {hasAccounts && ov ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            color="green"
            icon={<DollarSign />}
            label="Spend today"
            value={formatUsd(ov.spend_today_usd)}
            foot={`${ov.active_accounts} active account${ov.active_accounts === 1 ? "" : "s"}`}
          />
          <Kpi
            color="blue"
            icon={<BarChart3 />}
            label="Spend · 30d"
            value={formatUsd(ov.spend_30d_usd)}
            foot="last 30 days"
          />
          <Kpi
            color="navy"
            icon={<Megaphone />}
            label="Active campaigns"
            value={String(ov.active_campaigns)}
            foot={`${ov.campaigns} total`}
          />
          <Kpi
            color="orange"
            icon={<CheckSquare />}
            label="Pending approvals"
            value={String(ov.pending_approvals)}
            foot={ov.pending_approvals > 0 ? "needs your review" : "all clear"}
            tone={ov.pending_approvals > 0 ? "warn" : undefined}
          />
        </div>
      ) : (
        <ConnectCallout />
      )}

      {noSpendSynced && (
        <p className="text-sm text-muted-foreground">
          Metrics sync hourly from connected accounts. Nothing has synced
          yet, so spend reads zero rather than reflecting real activity.{" "}
          <Link href="/ads/insights" className="underline underline-offset-4">
            See insights
          </Link>
          .
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Feature
          icon={<Megaphone />}
          title="Agent-run campaigns"
          body="Agents draft, launch, and iterate on campaigns using your brand kit and existing content."
        />
        <Feature
          icon={<Workflow />}
          title="Durable optimization"
          body="Metrics sync, budget scaling, and creative rotation run as durable background workflows."
        />
        <Feature
          icon={<ShieldCheck />}
          title="Spend, governed"
          body="Every spend-affecting change passes a fail-closed budget guard, an approval gate, and an audit log."
        />
      </div>
    </div>
  );
}

function ConnectCallout() {
  return (
    <Card className="border-border/60 bg-card/40">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
        <div className="rounded-full bg-muted p-3">
          <Sparkles className="size-6 text-muted-foreground" aria-hidden />
        </div>
        <h2 className="text-lg font-semibold">Connect an ad account to begin</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Link Google Ads or Meta Ads. Connecting only grants access. Nothing
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
  color,
  icon,
  label,
  value,
  foot,
  tone,
}: {
  color: "green" | "blue" | "navy" | "orange";
  icon: React.ReactNode;
  label: string;
  value: string;
  foot: string;
  tone?: "warn";
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-center gap-2.5">
          <AppIcon color={color}>{icon}</AppIcon>
          <span className="text-sm font-medium text-muted-foreground">
            {label}
          </span>
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
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-2 pt-5">
        <AppIcon color="orange">{icon}</AppIcon>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}
