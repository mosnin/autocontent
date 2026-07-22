import Link from "next/link";
import {
  Users,
  UserPlus,
  Activity,
  FileText,
  DollarSign,
  Wallet,
  CreditCard,
  ShieldAlert,
} from "lucide-react";

import { fmtCompact } from "@/components/admin/format";
import { SquareStatsCards, type SquareStat } from "@/components/square/stats-cards";
import { Card, CardContent } from "@/components/square/ui/card";
import { fetchAdminOverview } from "@/lib/admin-server";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const o = await fetchAdminOverview();

  const failRate =
    o.jobs_24h > 0 ? Math.round((o.failed_jobs_24h / o.jobs_24h) * 100) : 0;

  // AdminKpiCard rows ported onto the template's SquareStatsCards — real
  // values in, no invented percentages. Jobs/24h and Suspended carry a
  // real derivable delta (failure rate, admin share); everything else
  // has no natural "trend" so it renders "—".
  const stats: SquareStat[] = [
    {
      key: "users",
      label: "Users",
      icon: Users,
      value: fmtCompact(o.total_users),
      delta:
        o.total_users > 0
          ? {
              text: `${o.admin_users} admin${o.admin_users === 1 ? "" : "s"}`,
            }
          : null,
    },
    {
      key: "new_users",
      label: "New this week",
      icon: UserPlus,
      value: fmtCompact(o.new_users_7d),
      delta: null,
    },
    {
      key: "jobs_24h",
      label: "Jobs · 24h",
      icon: Activity,
      value: fmtCompact(o.jobs_24h),
      delta:
        o.jobs_24h > 0
          ? {
              text: `${failRate}% failed`,
              trend: o.failed_jobs_24h > 0 ? "down" : "up",
            }
          : null,
    },
    {
      key: "articles_24h",
      label: "Articles · 24h",
      icon: FileText,
      value: fmtCompact(o.articles_24h),
      delta: { text: `${fmtCompact(o.total_articles)} all-time` },
    },
    {
      key: "spend_today",
      label: "Spend today",
      icon: DollarSign,
      value: formatUsd(o.spend_today_usd),
      delta: null,
    },
    {
      key: "spend_30d",
      label: "Spend · 30d",
      icon: Wallet,
      value: formatUsd(o.spend_30d_usd),
      delta: null,
    },
    {
      key: "credit_liability",
      label: "Credit liability",
      icon: CreditCard,
      value: formatUsd(o.credit_liability_usd),
      delta: null,
    },
    {
      key: "suspended",
      label: "Suspended",
      icon: ShieldAlert,
      value: fmtCompact(o.suspended_users),
      delta:
        o.suspended_users > 0
          ? { text: "accounts", trend: "down" }
          : { text: "accounts" },
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Platform health and usage across every account.
        </p>
      </div>

      <SquareStatsCards stats={stats} />

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
                  "relative inline-flex size-2 rounded-full",
                  failRate >= 20 ? "bg-warning" : "bg-success",
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
          <div>
            <div className="text-sm font-medium">Audit trail</div>
            <p className="text-sm text-muted-foreground">
              Every privileged action — suspensions, role changes, credit
              grants — is written to an append-only log for SOC 2 evidence.
            </p>
          </div>
          <Link
            href="/admin/audit"
            className="shrink-0 text-sm font-medium text-brand hover:underline"
          >
            View audit log →
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <div className="text-sm font-medium">Template library</div>
            <p className="text-sm text-muted-foreground">
              Curate reference looks + prompts that users remix with their
              own products.
            </p>
          </div>
          <Link
            href="/admin/templates"
            className="shrink-0 text-sm font-medium text-brand hover:underline"
          >
            Manage templates →
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
          warn ? "text-warning" : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}
