import { History, Inbox as InboxIcon, Megaphone, Plus, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { StartSession } from "../agent/start-session";
import { InboxRow } from "../inbox/inbox-row";
import { PageBody, PageHeader, PageIntro, SectionTitle, Stat, TitledCard } from "../page";
import { Badge, ButtonLink, Delta, Dot, Empty, Sparkbars } from "../ui";
import { ActionLog } from "./action-log";
import { CampaignList } from "./campaign-list";
import { accountName, platformLabel } from "./shared";
import { departmentById } from "@/lib/departments";
import { formatCompact, formatUsd } from "@/lib/format";
import type { AdAccount, AdActionEntry, AdCampaign, AdsOverview } from "@/lib/ads-client";
import type { InboxItem, Overview } from "@/lib/workspace";

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

function cap(v: string | null) {
  return v == null ? "No cap" : formatUsd(v, { cents: Number(v) % 1 !== 0 });
}

export function PaidView({ overview, workspace, accounts, campaigns, approvals, actions }: PaidData) {
  const dept = departmentById("paid")!;
  const live = (accounts ?? []).filter((a) => a.status !== "disconnected");
  const hasAccounts = live.length > 0;
  const k = workspace?.kpis;
  const pk = workspace?.previous_kpis;
  const spend30 = Number(overview?.spend_30d_usd ?? k?.ad_spend_usd ?? 0);
  const spendToday = Number(overview?.spend_today_usd ?? 0);
  const conv = k?.ad_conversions ?? 0;
  const cpa = conv > 0 ? spend30 / conv : null;
  const prevCpa = pk && pk.ad_conversions > 0 ? Number(pk.ad_spend_usd) / pk.ad_conversions : null;
  const series = workspace?.series ?? [];
  const pending = overview?.pending_approvals ?? approvals.length;
  const failed = overview === null && accounts === null && campaigns === null;

  return (
    <>
      <PageHeader icon={<Megaphone />} title="Paid media">
        <ButtonLink href="/paid/connect" size="sm" variant="ghost">
          Ad accounts
        </ButtonLink>
        {hasAccounts && (
          <ButtonLink href="/paid/campaigns/new" size="sm" variant="primary">
            <Plus />
            <span className="hidden sm:inline">New campaign</span>
          </ButtonLink>
        )}
      </PageHeader>
      <PageBody width="5xl">
        <PageIntro title="Ads that run inside your rules">
          The {dept.agentName} drafts, launches and tunes Google and Meta campaigns. Every change that moves money passes your caps, then waits for your yes.
        </PageIntro>

        <div className="t-stagger space-y-8">
          <StartSession scope="paid" lockScope suggestions={dept.asks} />

          {failed ? (
            <Empty art="activity" title="Paid media is out of reach">
              We couldn't load your ad accounts right now. Nothing has changed on the platforms; refresh in a moment.
            </Empty>
          ) : !hasAccounts ? (
            <Empty art="apps" title="Connect an ad account to begin" action={<ButtonLink href="/paid/connect" variant="primary">Connect an account</ButtonLink>}>
              Link Google Ads or Meta Ads. Connecting only grants access. Nothing can spend until you set a budget and approve it.
            </Empty>
          ) : (
            <>
              <section>
                <SectionTitle>Last 30 days</SectionTitle>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Stat label={<>Spend<span className="hidden text-faint tabular sm:inline"> · {formatUsd(spendToday)} today</span></>} value={formatUsd(spend30, { cents: false })} spark={<Sparkbars values={series.map((r) => Number(r.ad_spend_usd))} />} />
                  <Stat label="Clicks" value={formatCompact(k?.ad_clicks ?? 0)} delta={<Delta now={k?.ad_clicks ?? 0} before={pk?.ad_clicks ?? 0} />} />
                  <Stat label="Conversions" value={formatCompact(conv)} delta={<Delta now={conv} before={pk?.ad_conversions ?? 0} />} />
                  <Stat label="Cost per conversion" value={cpa == null ? "—" : formatUsd(cpa)} delta={cpa != null && prevCpa != null ? <Delta now={cpa} before={prevCpa} invert /> : undefined} />
                </div>
              </section>

              <div className="grid gap-3 md:grid-cols-5">
                <TitledCard
                  className="md:col-span-3"
                  icon={<InboxIcon />}
                  title="Waiting on your yes"
                  action={pending > 0 ? <Link href="/inbox" className="text-[13px] text-muted-foreground hover:text-foreground">Inbox</Link> : undefined}
                >
                  {approvals.length > 0 ? (
                    <div className="-mx-4 divide-y divide-border border-t border-border">
                      {approvals.map((it) => (
                        <InboxRow key={it.id} item={it} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-[13px] text-muted-foreground">Nothing to review. When the {dept.agentName} proposes a change above your approval threshold, it waits here. Nothing reaches a platform until you approve.</p>
                  )}
                </TitledCard>

                <TitledCard className="md:col-span-2" icon={<ShieldCheck />} title="Guardrails" action={<Link href="/paid/connect" className="text-[13px] text-muted-foreground hover:text-foreground">Edit</Link>}>
                  <ul className="space-y-3">
                    {live.map((a) => (
                      <li key={a.id} className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Dot tone={a.killswitch ? "danger" : a.status === "active" ? "live" : "warn"} />
                          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{accountName(a)}</span>
                          {a.killswitch && <Badge tone="danger">Kill switch on</Badge>}
                        </div>
                        <div className="mt-0.5 pl-[15px] text-[13px] text-muted-foreground tabular">
                          {platformLabel(a.platform)} · {cap(a.daily_cap_usd)}/day · {cap(a.monthly_cap_usd)}/month
                        </div>
                      </li>
                    ))}
                  </ul>
                </TitledCard>
              </div>

              <section>
                <SectionTitle
                  action={
                    <ButtonLink href="/paid/campaigns/new" size="sm" variant="ghost">
                      <Plus /> New
                    </ButtonLink>
                  }
                >
                  Campaigns · {overview?.active_campaigns ?? (campaigns ?? []).filter((c) => c.status === "active").length} live
                </SectionTitle>
                {campaigns && campaigns.length > 0 ? (
                  <CampaignList campaigns={campaigns} accounts={accounts ?? []} />
                ) : (
                  <Empty art="activity" title="No campaigns yet" action={<ButtonLink href="/paid/campaigns/new" variant="primary">Draft a campaign</ButtonLink>}>
                    Draft one yourself or ask the {dept.agentName}. Drafts never spend.
                  </Empty>
                )}
              </section>
            </>
          )}

          {actions && actions.length > 0 && (
            <section id="activity">
              <SectionTitle>
                <span className="inline-flex items-center gap-1.5">
                  <History className="size-[14px]" /> Ad actions · the audit trail for spend
                </span>
              </SectionTitle>
              <ActionLog actions={actions} />
            </section>
          )}
        </div>
      </PageBody>
    </>
  );
}
