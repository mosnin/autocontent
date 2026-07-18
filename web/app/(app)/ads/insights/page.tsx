import Link from "next/link";
import {
  BarChart3,
  DollarSign,
  Megaphone,
  MousePointerClick,
  Target,
  TrendingUp,
} from "lucide-react";

import { AppIcon } from "@/components/ui/app-icon";
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
import { api } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import type { AdCampaign, AdMetricsDaily } from "@/lib/ads-client";
import { adStatusLabel, adStatusVariant } from "@/lib/ads-format";

export const dynamic = "force-dynamic";

interface Detail {
  campaign: AdCampaign;
  metrics: AdMetricsDaily[];
}

interface CampaignTotals {
  campaign: AdCampaign;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  hasMetrics: boolean;
}

function sumMetrics(campaign: AdCampaign, metrics: AdMetricsDaily[]): CampaignTotals {
  const totals = metrics.reduce(
    (acc, m) => ({
      spend: acc.spend + Number(m.spend_usd),
      impressions: acc.impressions + m.impressions,
      clicks: acc.clicks + m.clicks,
      conversions: acc.conversions + Number(m.conversions),
      revenue: acc.revenue + Number(m.revenue_usd),
    }),
    { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 },
  );
  return { campaign, ...totals, hasMetrics: metrics.length > 0 };
}

export default async function AdsInsightsPage() {
  let campaigns: AdCampaign[] = [];
  try {
    campaigns = await api<AdCampaign[]>("/api/v1/ads/campaigns");
  } catch {
    campaigns = [];
  }

  const rows: CampaignTotals[] = await Promise.all(
    campaigns.map(async (c) => {
      try {
        const detail = await api<Detail>(`/api/v1/ads/campaigns/${c.id}`);
        return sumMetrics(c, detail.metrics);
      } catch {
        return sumMetrics(c, []);
      }
    }),
  );

  const hasMetrics = rows.some((r) => r.hasMetrics);
  const aggregate = rows.reduce(
    (acc, r) => ({
      spend: acc.spend + r.spend,
      impressions: acc.impressions + r.impressions,
      clicks: acc.clicks + r.clicks,
      conversions: acc.conversions + r.conversions,
      revenue: acc.revenue + r.revenue,
    }),
    { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 },
  );
  const roas = aggregate.spend > 0 ? aggregate.revenue / aggregate.spend : null;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Spend, reach, and return across every campaign, rolled up from
          synced platform metrics.
        </p>
      </header>

      {campaigns.length === 0 ? (
        <EmptyNoCampaigns />
      ) : (
        <>
          {hasMetrics ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Kpi
                color="green"
                icon={<DollarSign />}
                label="Spend"
                value={formatUsd(aggregate.spend)}
              />
              <Kpi
                color="navy"
                icon={<BarChart3 />}
                label="Impressions"
                value={aggregate.impressions.toLocaleString()}
              />
              <Kpi
                color="blue"
                icon={<MousePointerClick />}
                label="Clicks"
                value={aggregate.clicks.toLocaleString()}
              />
              <Kpi
                color="purple"
                icon={<Target />}
                label="Conversions"
                value={aggregate.conversions.toLocaleString(undefined, {
                  maximumFractionDigits: 1,
                })}
              />
              <Kpi
                color="orange"
                icon={<TrendingUp />}
                label="ROAS"
                value={roas === null ? "-" : `${roas.toFixed(2)}×`}
              />
            </div>
          ) : (
            <EmptyNoMetrics />
          )}

          <div className="overflow-x-auto">
            <Card className="min-w-[720px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign</TableHead>
                    <TableHead className="w-[130px]">Status</TableHead>
                    <TableHead className="w-[110px] text-right">Spend</TableHead>
                    <TableHead className="w-[100px] text-right">Clicks</TableHead>
                    <TableHead className="w-[120px] text-right">Conversions</TableHead>
                    <TableHead className="w-[90px] text-right">ROAS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const rRoas = r.spend > 0 ? r.revenue / r.spend : null;
                    return (
                      <TableRow key={r.campaign.id}>
                        <TableCell className="font-medium">
                          <Link
                            href={`/ads/campaigns/${r.campaign.id}`}
                            className="underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
                          >
                            {r.campaign.name}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge variant={adStatusVariant(r.campaign.status)}>
                            {adStatusLabel(r.campaign.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {r.hasMetrics ? formatUsd(r.spend) : "-"}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {r.hasMetrics ? r.clicks.toLocaleString() : "-"}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {r.hasMetrics
                            ? r.conversions.toLocaleString(undefined, {
                                maximumFractionDigits: 1,
                              })
                            : "-"}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {rRoas === null ? "-" : `${rRoas.toFixed(2)}×`}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          </div>
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
        <h3 className="text-lg font-semibold">No campaigns yet</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          Insights roll up once you have a campaign running. Create one to
          get started.
        </p>
        <Button asChild>
          <Link href="/ads/campaigns/new">New campaign</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function EmptyNoMetrics() {
  return (
    <Card className="border-border/60 bg-card/40">
      <CardContent className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <TrendingUp className="size-5 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">
          Metrics sync hourly from connected accounts.
        </p>
        <p className="text-sm text-muted-foreground">
          Nothing has synced yet.
        </p>
      </CardContent>
    </Card>
  );
}

function Kpi({
  color,
  icon,
  label,
  value,
}: {
  color: "green" | "blue" | "navy" | "orange" | "purple";
  icon: React.ReactNode;
  label: string;
  value: string;
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
        <p className="font-mono text-2xl font-semibold tabular-nums tracking-tight">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
