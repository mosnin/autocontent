"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { Megaphone, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  generateCreatives,
  type AdCampaign,
  type AdCreative,
} from "@/lib/ads-client";
import {
  adStatusLabel,
  adStatusVariant,
  describeAdsError,
  objectiveLabel,
} from "@/lib/ads-format";
import { CreativeCard } from "./CreativeCard";

const COUNT_OPTIONS = ["1", "3", "5", "8"];

export function CreativesClient({ campaigns }: { campaigns: AdCampaign[] }) {
  const [campaignId, setCampaignId] = React.useState<string>(campaigns[0]?.id ?? "");
  const [count, setCount] = React.useState("3");
  const [generating, setGenerating] = React.useState(false);

  const selected = campaigns.find((c) => c.id === campaignId) ?? null;

  const { data, mutate, isLoading } = useSWR<AdCreative[]>(
    campaignId ? adsKeys.creatives(campaignId) : null,
    clientFetch,
  );
  const creatives = data ?? [];

  async function onGenerate() {
    if (!campaignId) return;
    setGenerating(true);
    try {
      const created = await generateCreatives(campaignId, Number(count));
      toast.success(
        `${created.length} creative${created.length === 1 ? "" : "s"} generated`,
      );
      void mutate();
    } catch (err) {
      toast.error(describeAdsError(err));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Creative studio</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Generate ad copy variants for a campaign: headline, body, and call
            to action, written from your brand kit and the campaign&apos;s
            niche.
          </p>
        </div>
      </div>

      {campaigns.length === 0 ? (
        <EmptyNoCampaigns />
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-end gap-3 pt-5">
              <div className="min-w-[240px] flex-1 space-y-1.5">
                <label
                  htmlFor="campaign-picker"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Campaign
                </label>
                <Select value={campaignId} onValueChange={setCampaignId}>
                  <SelectTrigger id="campaign-picker" className="w-full">
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

              <div className="w-28 space-y-1.5">
                <label
                  htmlFor="count-picker"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Variants
                </label>
                <Select value={count} onValueChange={setCount}>
                  <SelectTrigger id="count-picker" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNT_OPTIONS.map((n) => (
                      <SelectItem key={n} value={n}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={onGenerate}
                disabled={!campaignId || generating}
                isLoading={generating}
              >
                <Sparkles className="size-3.5" aria-hidden />
                Generate
              </Button>

              {selected && (
                <div className="flex items-center gap-2 pb-1.5">
                  <Badge variant={adStatusVariant(selected.status)}>
                    {adStatusLabel(selected.status)}
                  </Badge>
                  {selected.objective && (
                    <span className="text-xs text-muted-foreground">
                      {objectiveLabel(selected.objective)}
                    </span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {!campaignId ? null : isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardContent className="space-y-3 pt-5">
                    <div className="h-4 w-2/3 rounded bg-muted" />
                    <div className="h-3 w-full rounded bg-muted" />
                    <div className="h-3 w-4/5 rounded bg-muted" />
                    <div className="h-6 w-20 rounded bg-muted" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : creatives.length === 0 ? (
            <EmptyNoCreatives name={selected?.name ?? "this campaign"} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {creatives.map((cr) => (
                <CreativeCard key={cr.id} creative={cr} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EmptyNoCampaigns() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="rounded-full bg-muted p-3">
          <Megaphone className="size-6 text-muted-foreground" aria-hidden />
        </div>
        <h3 className="text-lg font-semibold">Creatives attach to a campaign</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          Create a campaign first, then come back here to generate ad copy
          for it.
        </p>
        <Button asChild>
          <Link href="/ads/campaigns/new">New campaign</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function EmptyNoCreatives({ name }: { name: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="rounded-full bg-muted p-3">
          <Sparkles className="size-6 text-muted-foreground" aria-hidden />
        </div>
        <h3 className="text-lg font-semibold">No creatives yet</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          Generate ad copy for {name}. Variants are written from your brand
          kit and saved here.
        </p>
      </CardContent>
    </Card>
  );
}
