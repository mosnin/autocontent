"use client";

// Campaigns: orchestrate Studio content, Press SEO, and Ads together
// against a time window and a content-credit budget.

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  BannerCard,
  DashHeading,
  DashPanel,
  DashRise,
  MediaCard,
} from "@/components/hub/dashboard-kit";
import { hubCardClass } from "@/components/hub/primitives";
import { cn } from "@/lib/utils";
import type { Campaign, Niche } from "@/lib/types";

export function statusBadge(status: Campaign["status"]) {
  const variant =
    status === "running" ? "default" : status === "completed" ? "secondary" : "outline";
  return <Badge variant={variant}>{status}</Badge>;
}

export async function campaignMutate(path: string, method: string, body?: unknown) {
  const res = await fetch(`/api/proxy${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

export function CampaignsClient({
  initial,
  niches,
}: {
  initial: Campaign[];
  niches: Niche[];
}) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [objective, setObjective] = React.useState("");
  const [budget, setBudget] = React.useState("50");
  const [endsAt, setEndsAt] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const create = async () => {
    if (!name.trim()) {
      toast.error("Name the campaign");
      return;
    }
    setBusy(true);
    try {
      const campaign = await campaignMutate("/api/v1/campaigns", "POST", {
        name: name.trim(),
        objective,
        budget_usd: budget || "50",
        ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      });
      toast.success("Campaign created — add lanes and press start");
      router.push(`/campaigns/${campaign.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const running = initial.filter((c) => c.status === "running").length;

  return (
    <div className="space-y-10">
      <DashHeading as="h1" sub="Content, SEO, and ads in one push — set a budget, set a window, let it run.">
        Bring your next campaign to life
      </DashHeading>

      {/* Reference-style hero banners */}
      <div className="grid gap-5 lg:grid-cols-2">
        <DashRise delay={0.08}>
          <BannerCard
            href="#new-campaign"
            media={
              <div className="flex h-full min-h-44 flex-col justify-center gap-2 p-5">
                {["Name the push", "Cap the credits", "Press start"].map(
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
            tagline="Spin up a capped, multi-format push"
            title="New campaign"
            tone="warm"
          />
        </DashRise>
        <DashRise delay={0.16}>
          <BannerCard
            badge="Agents"
            href="/resources/guides/agent-driven-marketing"
            media={
              <div className="flex h-full min-h-44 flex-col justify-center gap-2 p-5">
                <div className="rounded-xl border border-border/60 bg-card px-3.5 py-2.5 text-[13px]">
                  <span className="text-muted-foreground">Running now: </span>
                  <span className="font-semibold">
                    {running} campaign{running === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="rounded-xl border border-border/60 bg-card px-3.5 py-2.5 font-mono text-[12px] text-muted-foreground">
                  $ marketer campaign create --cap 25.00
                </div>
                <div className="rounded-xl border border-border/60 bg-card px-3.5 py-2.5 text-[13px] text-muted-foreground">
                  Agents plan the queue, caps stop the spend.
                </div>
              </div>
            }
            tagline="Let an agent run the whole push"
            title="Autopilot"
            tone="sky"
          />
        </DashRise>
      </div>

      <DashPanel delay={0.1} title="Your campaigns">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {initial.map((c, i) => (
            <MediaCard
              foot={
                <>
                  Budget ${Number(c.budget_usd).toFixed(2)}
                  {c.ends_at
                    ? ` · ends ${new Date(c.ends_at).toLocaleDateString()}`
                    : " · open-ended"}
                </>
              }
              href={`/campaigns/${c.id}`}
              key={c.id}
              media={
                <div className="flex h-full min-h-28 flex-col justify-center gap-2.5 p-4">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="capitalize text-muted-foreground">
                      {c.status}
                    </span>
                    {statusBadge(c.status)}
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-zinc-900/10">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,#f59e0b,#f43f5e)]"
                      style={{
                        width: `${c.status === "completed" ? 100 : c.status === "running" ? 55 + ((i * 17) % 35) : 8}%`,
                      }}
                    />
                  </div>
                  {c.objective ? (
                    <p className="line-clamp-2 text-[12px] text-muted-foreground">
                      {c.objective}
                    </p>
                  ) : null}
                </div>
              }
              title={c.name}
              tone="warm"
            />
          ))}
          {initial.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No campaigns yet — create one below and press start.
            </p>
          )}
        </div>
      </DashPanel>

      <DashRise delay={0.12}>
      <Card className={cn(hubCardClass, "scroll-mt-24")} id="new-campaign">
        <CardHeader>
          <div className="grid gap-x-8 gap-y-1.5 md:grid-cols-2">
            <div className="space-y-1.5">
              <CardTitle className="text-lg font-semibold tracking-tight">
                New campaign
              </CardTitle>
              <CardDescription>
                The budget caps generation credits (videos + articles). Ad
                spend stays governed by the Ads product&apos;s guardrails.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="cmp-name">Name</Label>
              <Input id="cmp-name" value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Q3 product launch" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cmp-budget">Credit budget (USD)</Label>
              <Input id="cmp-budget" type="number" min={1} step="1"
                value={budget} onChange={(e) => setBudget(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="cmp-objective">Objective (optional)</Label>
              <Textarea id="cmp-objective" rows={2} value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder="Drive signups for the summer launch" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cmp-ends">Ends (optional)</Label>
              <Input id="cmp-ends" type="date" value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)} />
            </div>
          </div>
          <Button onClick={create} disabled={busy}>Create campaign</Button>
          {niches.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Tip: create a niche in Studio first — campaign lanes pull from
              your existing niches and ad campaigns.
            </p>
          )}
        </CardContent>
      </Card>
      </DashRise>
    </div>
  );
}
