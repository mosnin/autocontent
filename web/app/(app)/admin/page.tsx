import Link from "next/link";
import {
  Activity,
  Ban,
  DollarSign,
  FileText,
  ScrollText,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";

import { AdminKpiCard } from "@/components/admin/kpi-card";
import { fmtCompact } from "@/components/admin/format";
import { Card, CardContent } from "@/components/ui/card";
import { fetchAdminOverview } from "@/lib/admin-server";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const o = await fetchAdminOverview();

  const failRate =
    o.jobs_24h > 0 ? Math.round((o.failed_jobs_24h / o.jobs_24h) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Platform health and usage across every account.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AdminKpiCard
          color="navy"
          icon={<Users />}
          title="Users"
          value={fmtCompact(o.total_users)}
          foot={`${o.admin_users} admin${o.admin_users === 1 ? "" : "s"}`}
        />
        <AdminKpiCard
          color="green"
          icon={<UserPlus />}
          title="New this week"
          value={fmtCompact(o.new_users_7d)}
          foot="last 7 days"
        />
        <AdminKpiCard
          color="blue"
          icon={<Activity />}
          title="Jobs · 24h"
          value={fmtCompact(o.jobs_24h)}
          foot={`${o.failed_jobs_24h} failed`}
          trail={o.jobs_24h > 0 ? `${failRate}%` : undefined}
          tone={o.failed_jobs_24h > 0 ? "warn" : undefined}
        />
        <AdminKpiCard
          color="orange"
          icon={<FileText />}
          title="Articles · 24h"
          value={fmtCompact(o.articles_24h)}
          foot={`${fmtCompact(o.total_articles)} all-time`}
        />
        <AdminKpiCard
          color="green"
          icon={<DollarSign />}
          title="Spend today"
          value={formatUsd(o.spend_today_usd)}
          foot="all accounts"
        />
        <AdminKpiCard
          color="blue"
          icon={<TrendingUp />}
          title="Spend · 30d"
          value={formatUsd(o.spend_30d_usd)}
          foot="last 30 days"
        />
        <AdminKpiCard
          color="purple"
          icon={<Wallet />}
          title="Credit liability"
          value={formatUsd(o.credit_liability_usd)}
          foot="outstanding prepaid"
        />
        <AdminKpiCard
          color="orange"
          icon={<Ban />}
          title="Suspended"
          value={fmtCompact(o.suspended_users)}
          foot="accounts"
          tone={o.suspended_users > 0 ? "warn" : undefined}
        />
      </div>

      {/* platform health strip */}
      <Card>
        <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span
              aria-hidden
              className={cn(
                "relative flex size-2",
                failRate >= 20 ? "" : "opacity-90",
              )}
            >
              <span
                className={cn(
                  "absolute inline-flex size-full animate-ping rounded-full opacity-60",
                  failRate >= 20 ? "bg-brand" : "bg-success",
                )}
              />
              <span
                className={cn(
                  "relative inline-flex size-2 rounded-full",
                  failRate >= 20 ? "bg-brand" : "bg-success",
                )}
              />
            </span>
            Platform health
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:flex sm:items-center sm:gap-8">
            <HealthStat label="Niches" value={fmtCompact(o.total_niches)} />
            <HealthStat label="Jobs" value={fmtCompact(o.total_jobs)} />
            <HealthStat label="Articles" value={fmtCompact(o.total_articles)} />
            <HealthStat
              label="24h failure rate"
              value={`${failRate}%`}
              warn={failRate >= 20}
            />
          </div>
        </CardContent>
      </Card>

      {/* SOC2 note */}
      <Card className="border-border/60 bg-muted/30">
        <CardContent className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <ScrollText
              className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <div>
              <div className="text-sm font-medium">Audit trail</div>
              <p className="text-sm text-muted-foreground">
                Every privileged action — suspensions, role changes, credit
                grants — is written to an append-only log for SOC 2 evidence.
              </p>
            </div>
          </div>
          <Link
            href="/admin/audit"
            className="shrink-0 text-sm font-medium text-brand hover:underline"
          >
            View audit log →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

function HealthStat({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "font-mono text-lg font-semibold tabular-nums",
          warn ? "text-brand" : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}
