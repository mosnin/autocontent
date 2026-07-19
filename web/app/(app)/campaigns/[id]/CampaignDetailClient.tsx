"use client";

// One campaign: budget progress, lifecycle controls, and the lanes it
// orchestrates (video content, SEO articles, linked ad campaigns).

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
import { Progress } from "@/components/ui/progress";
import { campaignMutate, statusBadge } from "../CampaignsClient";
import type { CampaignOverview, Niche } from "@/lib/types";

const KIND_LABEL = { video: "Video content", article: "SEO articles", ad: "Ad campaign" } as const;

export function CampaignDetailClient({
  initial,
  niches,
}: {
  initial: CampaignOverview;
  niches: Niche[];
}) {
  const router = useRouter();
  const [ov, setOv] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const c = ov.campaign;

  const refresh = async () => {
    const res = await fetch(`/api/proxy/api/v1/campaigns/${c.id}`, { cache: "no-store" });
    if (res.ok) setOv(await res.json());
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      await refresh();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const spent = Number(ov.spent_usd);
  const budget = Number(c.budget_usd);
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;

  // add-lane form state
  const [kind, setKind] = React.useState<"video" | "article" | "ad">("video");
  const [refId, setRefId] = React.useState("");
  const [cadence, setCadence] = React.useState(3);

  const addLane = () =>
    act(async () => {
      if (!refId) throw new Error(kind === "ad" ? "Paste an ad campaign id" : "Pick a niche");
      await campaignMutate(`/api/v1/campaigns/${c.id}/items`, "POST", {
        kind, ref_id: refId, cadence_per_week: cadence,
      });
    }, "Lane added");

  const nicheName = (id: string) =>
    niches.find((n) => n.id === id)?.title ?? id.slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            {c.name} {statusBadge(c.status)}
          </h1>
          {c.objective && (
            <p className="mt-1 text-sm text-muted-foreground">{c.objective}</p>
          )}
        </div>
        <div className="flex gap-2">
          {c.status !== "running" && c.status !== "completed" && (
            <Button disabled={busy}
              onClick={() => act(() => campaignMutate(`/api/v1/campaigns/${c.id}/start`, "POST"), "Campaign running")}>
              Start
            </Button>
          )}
          {c.status === "running" && (
            <Button variant="outline" disabled={busy}
              onClick={() => act(() => campaignMutate(`/api/v1/campaigns/${c.id}/pause`, "POST"), "Campaign paused")}>
              Pause
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Budget</CardTitle>
          <CardDescription>
            Generation credits spent by this campaign. It completes
            automatically at the budget or the end date.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Progress value={pct} />
          <div className="flex justify-between text-sm">
            <span className="font-mono tabular-nums">${spent.toFixed(2)} spent</span>
            <span className="text-muted-foreground">
              of ${budget.toFixed(2)}
              {c.ends_at ? ` · ends ${new Date(c.ends_at).toLocaleDateString()}` : ""}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {ov.videos_total} videos · {ov.articles_total} articles produced
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lanes</CardTitle>
          <CardDescription>
            What this campaign runs. Video lanes generate and post to the
            niche&apos;s socials; article lanes publish SEO content; ad lanes
            link a governed ad campaign for one view of the push.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {ov.items.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No lanes yet — add one below.
            </p>
          )}
          {ov.items.map((item) => (
            <div key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
              <div className="text-sm">
                <span className="font-medium">{KIND_LABEL[item.kind]}</span>{" "}
                <span className="text-muted-foreground">
                  {item.kind === "ad" ? item.ref_id.slice(0, 8) : nicheName(item.ref_id)}
                  {item.kind !== "ad" && ` · ${item.cadence_per_week}/week`}
                </span>
                {!item.enabled && <Badge variant="outline" className="ml-2">off</Badge>}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={busy}
                  onClick={() => act(
                    () => campaignMutate(`/api/v1/campaigns/${c.id}/items/${item.id}`, "PATCH",
                      { enabled: !item.enabled }),
                    item.enabled ? "Lane paused" : "Lane enabled")}>
                  {item.enabled ? "Turn off" : "Turn on"}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy}
                  onClick={() => act(
                    () => campaignMutate(`/api/v1/campaigns/${c.id}/items/${item.id}`, "DELETE"),
                    "Lane removed")}>
                  Remove
                </Button>
              </div>
            </div>
          ))}

          <div className="grid gap-3 rounded-md border border-dashed p-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="lane-kind">Lane</Label>
              <select id="lane-kind" value={kind}
                onChange={(e) => { setKind(e.target.value as typeof kind); setRefId(""); }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="video">Video content</option>
                <option value="article">SEO articles</option>
                <option value="ad">Link ad campaign</option>
              </select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="lane-ref">
                {kind === "ad" ? "Ad campaign id" : "Niche"}
              </Label>
              {kind === "ad" ? (
                <Input id="lane-ref" value={refId}
                  onChange={(e) => setRefId(e.target.value)}
                  placeholder="uuid from Ads → Campaigns" />
              ) : (
                <select id="lane-ref" value={refId}
                  onChange={(e) => setRefId(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Pick a niche…</option>
                  {niches.map((n) => (
                    <option key={n.id} value={n.id}>{n.title}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lane-cadence">Per week</Label>
              <Input id="lane-cadence" type="number" min={1} max={56}
                value={cadence} disabled={kind === "ad"}
                onChange={(e) => setCadence(Number(e.target.value))} />
            </div>
            <div className="sm:col-span-4">
              <Button onClick={addLane} disabled={busy}>Add lane</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
