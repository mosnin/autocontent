"use client";

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
import {
  BannerCard,
  DashHeading,
  DashPanel,
  DashRise,
  MediaCard,
} from "@/components/hub/dashboard-kit";
import { hubCardClass } from "@/components/hub/primitives";
import { cn } from "@/lib/utils";
import { formatUsd } from "@/lib/format";
import type { AdsOverview } from "@/lib/ads-client";

export function AdsOverviewShell({ ov }: { ov: AdsOverview | null }) {
  const hasAccounts = (ov?.accounts ?? 0) > 0;
  const pending = ov?.pending_approvals ?? 0;

  return (
    <div className="space-y-10">
      <DashHeading
        as="h1"
        sub="Create, manage, and scale paid campaigns across Google and Meta — driven by agents, governed by hard budget guardrails."
      >
        Bring any campaign to market
      </DashHeading>

      <div className="grid gap-5 lg:grid-cols-2">
        <DashRise delay={0.08}>
          <BannerCard
            href="/ads/campaigns"
            media={
              <div className="flex h-full min-h-44 flex-col justify-center gap-2 p-5">
                {["Pick the objective", "Set a hard cap", "Agents take it live"].map(
                  (step, i) => (
                    <div
                      className="flex items-center gap-3 rounded-xl border border-border/60 bg-card px-3.5 py-2.5 text-[13px]"
                      key={step}
                    >
                      <span className="flex size-5 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-semibold text-white">
                        {i + 1}
                      </span>
                      <span className="font-medium">{step}</span>
                    </div>
                  ),
                )}
              </div>
            }
            tagline="Draft, launch, and scale a capped push"
            title="New ad campaign"
          />
        </DashRise>
        <DashRise delay={0.16}>
          <BannerCard
            badge="Gate"
            href="/ads/approvals"
            media={
              <div className="flex h-full min-h-44 flex-col justify-center gap-2 p-5">
                <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card px-3.5 py-2.5 text-[13px]">
                  <span className="font-medium">Waiting on you</span>
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-[11px] font-semibold",
                      pending > 0
                        ? "bg-amber-500/15 text-amber-600"
                        : "bg-zinc-900/5 text-muted-foreground",
                    )}
                  >
                    {pending}
                  </span>
                </div>
                <div className="rounded-xl border border-dashed border-border/70 bg-card/60 px-3.5 py-2.5 text-[13px] text-muted-foreground">
                  Budget raise · awaiting review
                </div>
                <div className="rounded-xl border border-dashed border-border/70 bg-card/60 px-3.5 py-2.5 text-[13px] text-muted-foreground">
                  Nothing spends until you say so.
                </div>
              </div>
            }
            tagline="Every spend change stops here first"
            title="Approvals"
          />
        </DashRise>
      </div>

      <DashPanel delay={0.1} title="Work the surface">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <MediaCard
            foot="Every push, its status, and its caps"
            href="/ads/campaigns"
            media={
              <div className="flex h-full min-h-28 flex-col justify-center gap-2.5 p-4">
                <div className="flex items-end justify-between gap-1.5">
                  {[34, 52, 41, 66, 58, 74, 47].map((h, i) => (
                    <div
                      className={cn(
                        "w-full rounded-t-[3px]",
                        i === 5
                          ? "bg-[linear-gradient(180deg,#f59e0b,#f43f5e)]"
                          : "bg-zinc-900/15",
                      )}
                      key={i}
                      style={{ height: h * 0.8 }}
                    />
                  ))}
                </div>
                <div className="flex items-center justify-between text-[11.5px] text-muted-foreground">
                  <span>7-day spend</span>
                  <span className="font-medium text-amber-600">capped</span>
                </div>
              </div>
            }
            title="Campaigns"
          />
          <MediaCard
            foot="Sync runs, scaling moves, audit trail"
            href="/ads/activity"
            media={
              <div className="flex h-full min-h-28 flex-col justify-center gap-1.5 p-4 text-[11.5px]">
                {[
                  ["Metrics sync", "2m ago"],
                  ["Creative rotated", "1h ago"],
                  ["Budget guard passed", "3h ago"],
                ].map(([label, when]) => (
                  <div
                    className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-2.5 py-1.5"
                    key={label}
                  >
                    <span className="truncate font-medium">{label}</span>
                    <span className="ml-2 shrink-0 text-muted-foreground">
                      {when}
                    </span>
                  </div>
                ))}
              </div>
            }
            title="Activity"
          />
          <MediaCard
            foot="Link Google Ads or Meta — access only"
            href="/ads/connect"
            media={
              <div className="flex h-full min-h-28 flex-col justify-center gap-1.5 p-4 text-[11.5px]">
                {[
                  ["Google Ads", hasAccounts ? "connected" : "not linked"],
                  ["Meta Ads", "not linked"],
                ].map(([name, state]) => (
                  <div
                    className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-2.5 py-2"
                    key={name}
                  >
                    <span className="font-medium">{name}</span>
                    <span
                      className={cn(
                        "ml-2 shrink-0",
                        state === "connected"
                          ? "font-medium text-amber-600"
                          : "text-muted-foreground",
                      )}
                    >
                      {state}
                    </span>
                  </div>
                ))}
                <p className="px-0.5 pt-1 text-muted-foreground">
                  Nothing spends until capped and approved.
                </p>
              </div>
            }
            title="Ad accounts"
          />
        </div>
      </DashPanel>

      <DashPanel delay={0.12} title="Today">
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
      </DashPanel>

      <DashPanel delay={0.14} title="How it runs">
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
      </DashPanel>
    </div>
  );
}

function ConnectCallout() {
  return (
    <Card className={cn(hubCardClass, "border-dashed")}>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
        <div className="rounded-full bg-muted p-3">
          <Sparkles className="size-6 text-muted-foreground" aria-hidden />
        </div>
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
    <Card className={hubCardClass}>
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
    <Card className={hubCardClass}>
      <CardContent className="space-y-2 pt-5">
        <AppIcon color="orange">{icon}</AppIcon>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}
