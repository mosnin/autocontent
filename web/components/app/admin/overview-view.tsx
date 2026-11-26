import { Activity, DollarSign, UserPlus, Users } from "lucide-react";
import { Facts, KpiCard, Section, StatusBadge } from "@/design-system";
import type { AdminOverview } from "@/lib/admin-types";
import { formatUsd } from "@/lib/format";
import { AdminFrame } from "./admin-frame";
import { fmtCompact } from "./format";

/** Admin overview (ref 05): four headline numbers, then the platform totals. The section row above is the way on. */
export function AdminOverviewView({ overview: o }: { overview: AdminOverview }) {
  const failRate = o.jobs_24h > 0 ? Math.round((o.failed_jobs_24h / o.jobs_24h) * 100) : 0;
  return (
    <AdminFrame>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard icon={<Users />} label="Users" value={fmtCompact(o.total_users)} href="/admin/users" />
        <KpiCard icon={<UserPlus />} label="New this week" value={fmtCompact(o.new_users_7d)} href="/admin/users" />
        <KpiCard icon={<Activity />} label="Jobs · 24h" value={fmtCompact(o.jobs_24h)} href="/admin/health" />
        <KpiCard icon={<DollarSign />} label="Spend today" value={formatUsd(o.spend_today_usd)} />
      </div>
      <div className="pt-5">
        <Section title="Platform">
          <div className="grid gap-3 lg:grid-cols-2">
            <Facts
              items={[
                { label: "Spend · 30 days", value: formatUsd(o.spend_30d_usd) },
                { label: "Credit liability", value: formatUsd(o.credit_liability_usd) },
                { label: "Articles · 24h", value: fmtCompact(o.articles_24h) },
                { label: "Failed jobs · 24h", value: <span className="inline-flex items-center gap-2">{o.failed_jobs_24h} <StatusBadge tone={failRate >= 20 ? "attention" : "positive"}>{failRate}%</StatusBadge></span> },
              ]}
            />
            <Facts
              items={[
                { label: "Suspended users", value: fmtCompact(o.suspended_users) },
                { label: "Admins", value: fmtCompact(o.admin_users) },
                { label: "Playbooks, all time", value: fmtCompact(o.total_niches) },
                { label: "Jobs · articles, all time", value: `${fmtCompact(o.total_jobs)} · ${fmtCompact(o.total_articles)}` },
              ]}
            />
          </div>
        </Section>
      </div>
    </AdminFrame>
  );
}
