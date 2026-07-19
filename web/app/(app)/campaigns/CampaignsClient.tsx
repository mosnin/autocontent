"use client";

// Campaigns: orchestrate Studio content, Press SEO, and Ads together
// against a time window and a content-credit budget.

import * as React from "react";
import Link from "next/link";
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
  HoverLift,
  HubHeading,
  HubSection,
  Rise,
  hubCardClass,
  hubCardHoverClass,
} from "@/components/hub/primitives";
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

  return (
    <div className="space-y-8">
      <Rise>
        <HubHeading as="h1">Campaigns</HubHeading>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Pull content, SEO, and ads into one push — set a budget, set a
          window, let it run.
        </p>
      </Rise>

      <Rise delay={0.08}>
      <Card className={cn(hubCardClass, "border-dashed")}>
        <CardHeader>
          <CardTitle className="text-base">New campaign</CardTitle>
          <CardDescription>
            The budget caps generation credits (videos + articles). Ad
            spend stays governed by the Ads product&apos;s guardrails.
          </CardDescription>
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
      </Rise>

      <HubSection index={2} title="Your campaigns">
        <div className="grid gap-4 sm:grid-cols-2">
          {initial.map((c) => (
            <HoverLift key={c.id}>
              <Link className="block h-full" href={`/campaigns/${c.id}`}>
                <Card className={cn(hubCardClass, hubCardHoverClass, "h-full")}>
                  <CardHeader className="flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-base">{c.name}</CardTitle>
                    {statusBadge(c.status)}
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    Budget ${Number(c.budget_usd).toFixed(2)}
                    {c.ends_at
                      ? ` · ends ${new Date(c.ends_at).toLocaleDateString()}`
                      : " · open-ended"}
                    {c.objective ? ` · ${c.objective}` : ""}
                  </CardContent>
                </Card>
              </Link>
            </HoverLift>
          ))}
          {initial.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No campaigns yet — create one above and press start.
            </p>
          )}
        </div>
      </HubSection>
    </div>
  );
}
