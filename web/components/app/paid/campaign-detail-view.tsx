"use client";

import { Pause, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { AskPill, Button, Callout, Card, ChartCard, Column, ConfirmModal, Facts, Field, KpiCard, LineChart, MoneyInput, Notice, PageHeader, Section, StatusBadge, Table } from "@/design-system";
import { adsErrorMessage, changeBudget, changeCampaignStatus, isPendingApproval, type AdAccount, type AdCampaign, type AdMetricsDaily } from "@/lib/ads-client";
import { formatCompact, formatDate, formatUsd } from "@/lib/format";
import { useAutoRefresh } from "@/lib/proxy-fetch";
import { accountName, AdStatusBadge, capLabel, platformLabel } from "./shared";

type Busy = "budget" | "active" | "paused" | "ended" | null;

const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** One ad campaign (README §5 Detail): status actions, metrics, budget, facts, daily rows. */
export function CampaignDetailView({ campaign, metrics, account }: { campaign: AdCampaign; metrics: AdMetricsDaily[]; account: AdAccount | null }) {
  useAutoRefresh(30_000);
  const router = useRouter();
  const [budget, setBudget] = useState(campaign.daily_budget_usd ?? "");
  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<{ ok?: string; error?: string } | null>(null);
  const [confirm, setConfirm] = useState<"active" | "ended" | null>(null);

  const sorted = [...metrics].sort((a, b) => a.date.localeCompare(b.date));
  const totals = metrics.reduce(
    (acc, m) => ({ spend: acc.spend + Number(m.spend_usd), revenue: acc.revenue + Number(m.revenue_usd), clicks: acc.clicks + m.clicks, impressions: acc.impressions + m.impressions }),
    { spend: 0, revenue: 0, clicks: 0, impressions: 0 },
  );
  const roas = totals.spend > 0 ? totals.revenue / totals.spend : null;

  async function onBudget(e: FormEvent) {
    e.preventDefault();
    setBusy("budget");
    setNote(null);
    try {
      const res = await changeBudget(campaign.id, budget || "0");
      setNote(isPendingApproval(res) ? { ok: "Over your approval threshold, so it's waiting in your inbox. Nothing has changed yet." } : { ok: "Budget updated." });
      router.refresh();
    } catch (err) {
      setNote({ error: adsErrorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  async function onStatus(status: "active" | "paused" | "ended") {
    setBusy(status);
    setNote(null);
    try {
      const res: unknown = await changeCampaignStatus(campaign.id, status);
      setConfirm(null);
      setNote(isPendingApproval(res) ? { ok: "Activation needs your approval. It's in your inbox; the campaign stays off until you approve." } : { ok: status === "active" ? "Campaign is live." : status === "paused" ? "Campaign paused." : "Campaign ended." });
      router.refresh();
    } catch (err) {
      setConfirm(null);
      setNote({ error: adsErrorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  const canActivate = campaign.status !== "active" && campaign.status !== "ended";
  const recent = [...sorted].reverse().slice(0, 14);
  const ask = `How is the "${campaign.name}" campaign doing, and what should change?`;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Paid media", href: "/paid" }, { label: campaign.name }]}
        actions={
          <>
            {canActivate && (
              <Button variant="primary" onClick={() => setConfirm("active")} disabled={busy !== null}>
                <Play /> Activate
              </Button>
            )}
            {campaign.status === "active" && (
              <Button onClick={() => void onStatus("paused")} loading={busy === "paused"} disabled={busy !== null}>
                <Pause /> Pause
              </Button>
            )}
          </>
        }
      />
      <Column
        width="md"
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {campaign.name} <AdStatusBadge status={campaign.status} />
          </span>
        }
        description={
          <>
            <span className="capitalize">{campaign.objective ? campaign.objective.replace(/_/g, " ") : "No objective"}</span>
            {account && ` · ${platformLabel(account.platform)} · ${accountName(account)}`}
          </>
        }
      >
        {(note || campaign.last_error) && (
          <div className="space-y-3">
            {note && <Notice ok={note.ok} error={note.error} />}
            {campaign.last_error && <Callout tone="negative">{campaign.last_error}</Callout>}
          </div>
        )}

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard label="Spend" value={formatUsd(totals.spend, { cents: false })} bars={sorted.map((m) => Number(m.spend_usd))} />
            <KpiCard label="ROAS" value={roas === null ? "—" : `${roas.toFixed(2)}×`} />
            <KpiCard label="Clicks" value={formatCompact(totals.clicks)} />
            <KpiCard label="Impressions" value={formatCompact(totals.impressions)} />
          </div>
          {sorted.length > 1 && (
            <ChartCard label="Spend per day" value={formatUsd(totals.spend)}>
              <LineChart series={[{ label: "Spend", kind: "current", values: sorted.map((m) => Number(m.spend_usd)) }]} xLabels={sorted.map((m) => day(m.date))} height={180} format={(n) => `$${Math.round(n)}`} />
            </ChartCard>
          )}
        </div>

        <Section title="Daily budget">
          <Card className="p-4">
            <form onSubmit={onBudget} className="flex flex-wrap items-end gap-3">
              <div className="w-40">
                <Field label="Per day">
                  <MoneyInput id="daily-budget" value={budget} onChange={(e) => setBudget(e.target.value)} />
                </Field>
              </div>
              <Button type="submit" variant="primary" loading={busy === "budget"} disabled={busy !== null}>
                Update budget
              </Button>
            </form>
            <p className="mt-3 text-[12px] text-fg-muted">Large increases wait for approval. Changes over your caps or with the kill switch on are refused.</p>
          </Card>
        </Section>

        <Section title="Details">
          <Facts
            items={[
              { label: "Status", value: <AdStatusBadge status={campaign.status} /> },
              { label: "Daily budget", value: campaign.daily_budget_usd ? `${formatUsd(campaign.daily_budget_usd)}/day` : "Not set" },
              ...(account
                ? [
                    { label: "Account", value: `${platformLabel(account.platform)} · ${accountName(account)}` },
                    { label: "Account caps", value: `${capLabel(account.daily_cap_usd)}/day · ${capLabel(account.monthly_cap_usd)}/month` },
                    { label: "Kill switch", value: account.killswitch ? <StatusBadge tone="negative">On</StatusBadge> : "Off" },
                  ]
                : []),
              { label: "Platform ID", value: <span className="font-mono text-[12px]">{campaign.external_campaign_id || "Not launched"}</span> },
              { label: "Created", value: formatDate(campaign.created_at) },
            ]}
          />
        </Section>

        {recent.length > 0 && (
          <Section title="Daily">
            <Table
              rows={recent}
              rowKey={(m) => m.date}
              columns={[
                { key: "day", label: "Day", render: (m) => day(m.date) },
                { key: "impr", label: "Impressions", align: "right", render: (m) => formatCompact(m.impressions) },
                { key: "clicks", label: "Clicks", align: "right", render: (m) => formatCompact(m.clicks) },
                { key: "spend", label: "Spend", align: "right", render: (m) => formatUsd(m.spend_usd) },
              ]}
            />
          </Section>
        )}

        {campaign.status !== "ended" && (
          <Callout
            title="End this campaign"
            action={
              <Button size="sm" variant="danger" onClick={() => setConfirm("ended")} disabled={busy !== null}>
                End campaign
              </Button>
            }
          >
            Stops it for good. Pause instead if you might bring it back.
          </Callout>
        )}

        <AskPill label="Ask about this campaign" href={`/sessions/new?dept=paid&q=${encodeURIComponent(ask)}`} />
      </Column>

      <ConfirmModal open={confirm === "active"} onClose={() => setConfirm(null)} title="Activate this campaign?" confirmLabel="Activate" busy={busy === "active"} onConfirm={() => void onStatus("active")}>
        <p>
          It can start spending up to <span className="font-medium text-fg tabular">{campaign.daily_budget_usd ? `${formatUsd(campaign.daily_budget_usd)}/day` : "its daily budget"}</span> on {account ? platformLabel(account.platform) : "the platform"}.
        </p>
        <p>Activation passes the same spend guard as a budget change. Over your approval threshold, it waits in your inbox and stays off until you approve.</p>
        {account?.killswitch && <StatusBadge tone="negative">Kill switch is on: this will be refused</StatusBadge>}
      </ConfirmModal>
      <ConfirmModal open={confirm === "ended"} onClose={() => setConfirm(null)} title="End this campaign?" confirmLabel="End campaign" danger busy={busy === "ended"} onConfirm={() => void onStatus("ended")}>
        <p>Ending stops delivery for good and can't be undone here. Pausing keeps it so you can resume later.</p>
      </ConfirmModal>
    </>
  );
}
