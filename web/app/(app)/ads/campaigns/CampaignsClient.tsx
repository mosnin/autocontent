"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { Megaphone, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { clientFetch } from "@/lib/client-fetcher";
import { formatUsd } from "@/lib/format";
import { adsKeys, type AdCampaign } from "@/lib/ads-client";
import { adStatusLabel, adStatusVariant, objectiveLabel } from "@/lib/ads-format";

// Re-exported for existing client-side consumers (e.g. CampaignDetailClient).
// The canonical definition lives in ads-format.ts, a plain module safe to
// import from server components too (insights/page.tsx uses it directly).
export const statusVariant = adStatusVariant;

export function CampaignsClient({
  initial,
  hasAccounts,
}: {
  initial: AdCampaign[];
  hasAccounts: boolean;
}) {
  const { data } = useSWR<AdCampaign[]>(adsKeys.campaigns(), clientFetch, {
    fallbackData: initial,
    refreshInterval: 30_000,
  });
  const campaigns = data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="text-sm text-muted-foreground">
            Draft, launch, and scale campaigns. Budgets and activation pass the
            spend guard before anything goes live.
          </p>
        </div>
        {hasAccounts && (
          <Button asChild size="sm">
            <Link href="/ads/campaigns/new">
              <Plus className="size-4" aria-hidden />
              New campaign
            </Link>
          </Button>
        )}
      </div>

      {!hasAccounts ? (
        <EmptyNoAccounts />
      ) : campaigns.length === 0 ? (
        <EmptyNoCampaigns />
      ) : (
        <div className="overflow-x-auto">
          <Card className="min-w-[680px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-[110px]">Status</TableHead>
                  <TableHead className="w-[130px]">Objective</TableHead>
                  <TableHead className="w-[120px] text-right">Daily budget</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/ads/campaigns/${c.id}`}
                        className="underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
                      >
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(c.status)}>
                        {adStatusLabel(c.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.objective ? objectiveLabel(c.objective) : "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {c.daily_budget_usd ? formatUsd(c.daily_budget_usd) : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}

function EmptyNoAccounts() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="rounded-full bg-muted p-3">
          <Megaphone className="size-6 text-muted-foreground" aria-hidden />
        </div>
        <h3 className="text-lg font-semibold">Connect an account first</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          Link Google Ads or Meta Ads before creating campaigns.
        </p>
        <Button asChild>
          <Link href="/ads/connect">Connect an account</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function EmptyNoCampaigns() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="rounded-full bg-muted p-3">
          <Megaphone className="size-6 text-muted-foreground" aria-hidden />
        </div>
        <h3 className="text-lg font-semibold">No campaigns yet</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          Create a draft campaign. It won&apos;t spend until you set a budget
          and activate it.
        </p>
        <Button asChild>
          <Link href="/ads/campaigns/new">
            <Plus className="size-4" aria-hidden />
            New campaign
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
