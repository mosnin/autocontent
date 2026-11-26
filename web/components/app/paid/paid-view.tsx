"use client";

import { Megaphone, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { ButtonLink, Column, EmptyLine, KpiCard, PageHeader, Section, Segmented, StatusBadge, Table, ApprovalCard, ToolTitle } from "@/design-system";
import { StartSession } from "@/components/chat/start-session";
import { TOOL_ICON } from "@/components/shell/sidebar";
import type { AdAccount, AdActionEntry, AdCampaign, AdsOverview } from "@/lib/ads-client";
import { departmentById } from "@/lib/departments";
import { formatCompact, formatRelative, formatUsd } from "@/lib/format";
import type { InboxItem, Overview } from "@/lib/workspace";
import { ActionLog } from "./action-log";
import { CampaignTable } from "./campaign-table";
import { accountName, capLabel, platformLabel, PlatformTile } from "./shared";

export interface PaidData {
  overview: AdsOverview | null;
  /** Workspace overview (30 days) for ad clicks, conversions and the spend series. */
  workspace: Overview | null;
  accounts: AdAccount[] | null;
  campaigns: AdCampaign[] | null;
  /** Pending ad changes (inbox items of kind ad_change). */
  approvals: InboxItem[];
  actions: AdActionEntry[] | null;
}

function pct(now: number, before: number | null | undefined) {
  if (before == null || !before) return null;
  return ((now - before) / before) * 100;
}

type Detail = "campaigns" | "guardrails" | "activity";

/**
 * Paid media (README §5 Tool). Summary first: ask, the 30-day numbers and,
 * only when there is something, what needs you. The detail (campaigns,
 * guardrails, the audit trail) is one segmented control below, so the page is
 * never all three tables at once. /paid#activity opens the audit trail.
 */
export function PaidView({ overview, workspace, accounts, campaigns, approvals, actions }: PaidData) {
  const [detail, setDetail] = useState<Detail>("campaigns");
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (h === "activity" || h === "guardrails") setDetail(h);
  }, []);
  const dept = departmentById("paid")!;
  const tool = TOOL_ICON.paid;
  const live = (accounts ?? []).filter((a) => a.status !== "disconnected");
  const hasAccounts = live.length > 0;
  const k = workspace?.kpis;
  const pk = workspace?.previous_kpis;
  const spend30 = Number(overview?.spend_30d_usd ?? k?.ad_spend_usd ?? 0);
  const spendToday = Number(overview?.spend_today_usd ?? 0);
  const clicks = k?.ad_clicks ?? 0;
  const conv = k?.ad_conversions ?? 0;
  const cpa = conv > 0 ? spend30 / conv : null;
  const prevCpa = pk && pk.ad_conversions > 0 ? Number(pk.ad_spend_usd) / pk.ad_conversions : null;
  const series = workspace?.series ?? [];
  const failed = overview === null && accounts === null && campaigns === null;
  const liveCampaigns = overview?.active_campaigns ?? (campaigns ?? []).filter((c) => c.status === "active").length;

  return (
    <>
      <PageHeader
        icon={<Megaphone />}
        title="Paid media"
        actions={
          <>
            <ButtonLink href="/paid/connect" size="md" variant="ghost">
              Ad accounts
            </ButtonLink>
            {hasAccounts && (
              <ButtonLink href="/paid/campaigns/new" size="md" variant="primary">
                <Plus />
                <span className="hidden sm:inline">New campaign</span>
              </ButtonLink>
            )}
          </>
        }
      />
      <Column width="lg" title={<ToolTitle icon={tool.icon} tone={tool.tone}>Paid media</ToolTitle>} description={dept.summary}>
        <StartSession scope="paid" lockScope />

        {failed ? (
          <EmptyLine>Paid media is out of reach right now. Nothing has changed on the platforms.</EmptyLine>
        ) : !hasAccounts ? (
          <EmptyLine
            action={
              <ButtonLink href="/paid/connect" variant="primary">
                Connect an account
              </ButtonLink>
            }
          >
            Connect Google Ads or Meta Ads. Nothing spends until you set a budget and approve it.
          </EmptyLine>
        ) : (
          <>
            <Section title="Last 30 days">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <KpiCard label={`Spend · ${formatUsd(spendToday, { cents: false })} today`} value={formatUsd(spend30, { cents: false })} delta={pct(spend30, pk ? Number(pk.ad_spend_usd) : null)} bars={series.map((r) => Number(r.ad_spend_usd))} />
                <KpiCard label="Clicks" value={formatCompact(clicks)} delta={pct(clicks, pk?.ad_clicks)} />
                <KpiCard label="Conversions" value={formatCompact(conv)} delta={pct(conv, pk?.ad_conversions)} />
                <KpiCard label="Cost per conversion" value={cpa == null ? "—" : formatUsd(cpa)} delta={cpa != null ? pct(cpa, prevCpa) : null} invert />
              </div>
            </Section>

            {approvals.length > 0 && (
              <Section title="Needs you" count={approvals.length}>
                <div className="space-y-3">
                  {approvals.map((it) => (
                    <ApprovalCard
                      key={it.id}
                      item={it}
                      title={it.title}
                      icon={<Megaphone className="size-3.5 text-on-fill" />}
                      meta={formatRelative(it.created_at)}
                      steps={[{ label: it.detail }, { label: "Checked against account caps and the kill switch" }, { label: "Applied on the platform when you approve" }]}
                    />
                  ))}
                </div>
              </Section>
            )}

            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Segmented
                  label="Paid media detail"
                  value={detail}
                  onChange={setDetail}
                  options={[
                    { value: "campaigns", label: <>Campaigns <span className="font-normal text-fg-faint tabular">{liveCampaigns} live</span></> },
                    { value: "guardrails", label: "Guardrails" },
                    ...(actions && actions.length > 0 ? [{ value: "activity" as const, label: "Audit trail" }] : []),
                  ]}
                />
                {detail === "guardrails" && (
                  <ButtonLink href="/paid/connect" size="sm" variant="ghost">
                    Edit guardrails
                  </ButtonLink>
                )}
              </div>
              <div key={detail} id={detail === "activity" ? "activity" : undefined} className="ds-swap">
                {detail === "guardrails" ? (
              <Table
                rows={live}
                rowKey={(a) => a.id}
                columns={[
                  {
                    key: "account",
                    label: "Account",
                    render: (a) => (
                      <span className="flex min-w-0 items-center gap-2.5">
                        <PlatformTile platform={a.platform} size={24} />
                        <span className="min-w-0">
                          <span className="block truncate">{accountName(a)}</span>
                          <span className="block truncate text-[12px] text-fg-muted">{platformLabel(a.platform)}</span>
                        </span>
                      </span>
                    ),
                  },
                  { key: "daily", label: "Daily cap", align: "right", render: (a) => capLabel(a.daily_cap_usd) },
                  { key: "monthly", label: "Monthly cap", align: "right", hideOnPhone: true, render: (a) => capLabel(a.monthly_cap_usd) },
                  {
                    key: "state",
                    label: "Spend",
                    align: "right",
                    width: "120px",
                    render: (a) => (a.killswitch ? <StatusBadge tone="negative">Kill switch on</StatusBadge> : a.status === "active" ? <StatusBadge tone="positive">Allowed</StatusBadge> : <StatusBadge tone="attention">Not ready</StatusBadge>),
                  },
                ]}
              />
                ) : detail === "activity" && actions ? (
                  <ActionLog actions={actions} />
                ) : campaigns && campaigns.length > 0 ? (
                <CampaignTable campaigns={campaigns} accounts={accounts ?? []} />
              ) : (
                <EmptyLine
                  action={
                    <ButtonLink href="/paid/campaigns/new" variant="secondary">
                      Draft a campaign
                    </ButtonLink>
                  }
                >
                  No campaigns yet. Drafts never spend.
                </EmptyLine>
                )}
              </div>
            </section>
          </>
        )}

        {(failed || !hasAccounts) && actions && actions.length > 0 && (
          <Section title="Audit trail" id="activity">
            <ActionLog actions={actions} />
          </Section>
        )}
      </Column>
    </>
  );
}
