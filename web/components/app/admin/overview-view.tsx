import { Activity, CreditCard, DollarSign, FileText, ShieldAlert, UserPlus, Users, Wallet } from "lucide-react";
import { Facts, KpiCard, List, ListRow, Section, StatusBadge } from "@/design-system";
import type { AdminOverview } from "@/lib/admin-types";
import { formatUsd } from "@/lib/format";
import { AdminFrame } from "./admin-frame";
import { fmtCompact } from "./format";

const LINKS = [
  { href: "/admin/users", label: "Users", line: "Search, suspend, change roles, grant credits" },
  { href: "/admin/audit", label: "Audit log", line: "Every privileged action, append-only" },
  { href: "/admin/health", label: "Health", line: "Database, stuck work, provider error rates" },
  { href: "/admin/templates", label: "Templates", line: "Reference looks users remix" },
];

/** Admin overview (ref 05): KPI rows, platform totals, and where to go next. */
export function AdminOverviewView({ overview: o }: { overview: AdminOverview }) {
  const failRate = o.jobs_24h > 0 ? Math.round((o.failed_jobs_24h / o.jobs_24h) * 100) : 0;
  return (
    <AdminFrame>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard icon={<Users />} label="Users" value={fmtCompact(o.total_users)} />
        <KpiCard icon={<UserPlus />} label="New this week" value={fmtCompact(o.new_users_7d)} href="/admin/users" />
        <KpiCard icon={<Activity />} label="Jobs · 24h" value={fmtCompact(o.jobs_24h)} href="/admin/health" />
        <KpiCard icon={<FileText />} label="Articles · 24h" value={fmtCompact(o.articles_24h)} />
        <KpiCard icon={<DollarSign />} label="Spend today" value={formatUsd(o.spend_today_usd)} />
        <KpiCard icon={<Wallet />} label="Spend · 30d" value={formatUsd(o.spend_30d_usd)} />
        <KpiCard icon={<CreditCard />} label="Credit liability" value={formatUsd(o.credit_liability_usd)} />
        <KpiCard icon={<ShieldAlert />} label="Suspended" value={fmtCompact(o.suspended_users)} href="/admin/users" />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="Platform">
          <Facts
            items={[
              { label: "Admins", value: fmtCompact(o.admin_users) },
              { label: "Niches", value: fmtCompact(o.total_niches) },
              { label: "Jobs, all time", value: fmtCompact(o.total_jobs) },
              { label: "Articles, all time", value: fmtCompact(o.total_articles) },
              { label: "Failed jobs · 24h", value: <span className="inline-flex items-center gap-2">{o.failed_jobs_24h} <StatusBadge tone={failRate >= 20 ? "attention" : "positive"}>{failRate}%</StatusBadge></span> },
            ]}
          />
        </Section>
        <Section title="Go to">
          <List>
            {LINKS.map((l) => (
              <ListRow key={l.href} href={l.href}>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">{l.label}</div>
                  <div className="truncate text-[12px] text-fg-muted">{l.line}</div>
                </div>
              </ListRow>
            ))}
          </List>
        </Section>
      </div>
    </AdminFrame>
  );
}
