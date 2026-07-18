"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { FlaskConical, Plus } from "lucide-react";

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
import { adsKeys, type AdCampaign, type AdExperiment } from "@/lib/ads-client";
import { ExperimentCard } from "./ExperimentCard";
import { NewExperimentDialog } from "./NewExperimentDialog";

export function ExperimentsClient({ campaigns }: { campaigns: AdCampaign[] }) {
  const [campaignFilter, setCampaignFilter] = React.useState<string>("all");
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const { data, mutate, isLoading } = useSWR<AdExperiment[]>(
    adsKeys.experiments(campaignFilter === "all" ? undefined : campaignFilter),
    clientFetch,
    { refreshInterval: 20_000 },
  );
  const experiments = data ?? [];
  const campaignById = new Map(campaigns.map((c) => [c.id, c]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Experiments</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Creative A/B tests and governed budget ramps. Every spend-
            affecting step runs through the same guard and approval gate as
            the rest of Ads.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} disabled={campaigns.length === 0}>
          <Plus className="size-3.5" aria-hidden />
          New experiment
        </Button>
      </div>

      {campaigns.length === 0 ? (
        <EmptyNoCampaigns />
      ) : (
        <>
          <div className="flex items-center gap-3">
            <Select value={campaignFilter} onValueChange={setCampaignFilter}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All campaigns</SelectItem>
                {campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardContent className="space-y-3 pt-5">
                    <div className="h-4 w-2/3 rounded bg-muted" />
                    <div className="h-3 w-full rounded bg-muted" />
                    <div className="h-6 w-20 rounded bg-muted" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : experiments.length === 0 ? (
            <EmptyNoExperiments />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {experiments.map((exp) => (
                <ExperimentCard
                  key={exp.id}
                  experiment={exp}
                  campaign={campaignById.get(exp.campaign_id)}
                  onChanged={() => void mutate()}
                />
              ))}
            </div>
          )}
        </>
      )}

      <NewExperimentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        campaigns={campaigns}
        onCreated={() => void mutate()}
      />
    </div>
  );
}

function EmptyNoCampaigns() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="rounded-full bg-muted p-3">
          <FlaskConical className="size-6 text-muted-foreground" aria-hidden />
        </div>
        <h3 className="text-lg font-semibold">Experiments attach to a campaign</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          Create a campaign first, then come back here to run a creative test
          or a budget ramp on it.
        </p>
        <Button asChild>
          <Link href="/ads/campaigns/new">New campaign</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function EmptyNoExperiments() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="rounded-full bg-muted p-3">
          <FlaskConical className="size-6 text-muted-foreground" aria-hidden />
        </div>
        <h3 className="text-lg font-semibold">No experiments yet</h3>
        <div className="max-w-md space-y-2 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">Creative A/B test:</strong>{" "}
            rotate 2-4 existing creatives on a campaign and pick a winner by
            ROAS or CTR once each has enough attributed days.
          </p>
          <p>
            <strong className="text-foreground">Budget ramp:</strong> step a
            campaign&apos;s daily budget toward a target, a bounded percent
            at a time, with your spend guard and approval threshold applied
            to every step.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
