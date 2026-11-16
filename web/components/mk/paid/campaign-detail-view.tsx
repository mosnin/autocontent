"use client";

import { Megaphone, Pause, Play, Square } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { adsErrorMessage, changeBudget, changeCampaignStatus, isPendingApproval, type AdAccount, type AdCampaign, type AdMetricsDaily } from "@/lib/ads-client";
import { formatCompact, formatUsd } from "@/lib/format";
import { Crumbs, PageBody, PageHeader, PageIntro, Panel, SectionTitle, Stat } from "../page";
import { Badge, Button, Sparkbars } from "../ui";
import { ConfirmModal, MoneyInput, SaveNote, useAutoRefresh } from "../settings/primitives";
import { accountName, AdStatusBadge, GuardLine, platformLabel } from "./shared";

type Busy = "budget" | "active" | "paused" | "ended" | null;

export function CampaignDetailView({ campaign, metrics, account }: { campaign: AdCampaign; metrics: AdMetricsDaily[]; account: AdAccount | null }) {
  useAutoRefresh(30_000);
  const router = useRouter();
  const [budget, setBudget] = useState(campaign.daily_budget_usd ?? "");
  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<{ ok?: string; error?: string } | null>(null);
  const [confirm, setConfirm] = useState<"active" | "ended" | null>(null);

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
      setNote(isPendingApproval(res) ? { ok: "That change is over your approval threshold, so it's waiting in your inbox. Nothing has changed yet." } : { ok: "Budget updated." });
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
      setNote(isPendingApproval(res) ? { ok: "Activation needs your approval first. It's in your inbox; the campaign stays off until you approve." } : { ok: status === "active" ? "Campaign is live." : status === "paused" ? "Campaign paused." : "Campaign ended." });
      router.refresh();
    } catch (err) {
      setConfirm(null);
      setNote({ error: adsErrorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  const canActivate = campaign.status !== "active" && campaign.status !== "ended";
  const recent = [...metrics].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);

  return (
    <>
      <PageHeader icon={<Megaphone />} title={<Crumbs items={[<Link key="p" href="/paid" className="hover:text-foreground">Paid media</Link>, campaign.name]} />}>
        {canActivate && (
          <Button size="sm" variant="primary" onClick={() => setConfirm("active")} disabled={busy !== null}>
            <Play /> Activate
          </Button>
        )}
        {campaign.status === "active" && (
          <Button size="sm" onClick={() => void onStatus("paused")} loading={busy === "paused"} disabled={busy !== null}>
            <Pause /> Pause
          </Button>
        )}
      </PageHeader>
      <PageBody width="4xl">
        <PageIntro
          title={
            <span className="inline-flex flex-wrap items-center gap-2.5">
              {campaign.name} <AdStatusBadge status={campaign.status} />
            </span>
          }
        >
          <span className="capitalize">{campaign.objective ? campaign.objective.replace(/_/g, " ") : "No objective"}</span>
          {account && (
            <>
              {" · "}
              {platformLabel(account.platform)} · {accountName(account)}
            </>
          )}
        </PageIntro>

        <div className="t-stagger space-y-6">
          {note && <SaveNote ok={note.ok} error={note.error} />}
          {campaign.last_error && <p className="rounded-[14px] bg-destructive/[0.06] px-4 py-3 text-[13px] text-destructive">{campaign.last_error}</p>}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Spend" value={formatUsd(totals.spend)} spark={<Sparkbars values={[...metrics].sort((a, b) => a.date.localeCompare(b.date)).map((m) => Number(m.spend_usd))} />} />
            <Stat label="ROAS" value={roas === null ? "—" : `${roas.toFixed(2)}×`} />
            <Stat label="Clicks" value={formatCompact(totals.clicks)} />
            <Stat label="Impressions" value={formatCompact(totals.impressions)} />
          </div>

          <Panel label="Daily budget">
            <form onSubmit={onBudget} className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="block w-40 space-y-1.5">
                  <span className="text-[13px] font-medium">Per day</span>
                  <MoneyInput id="daily-budget" value={budget} onChange={(e) => setBudget(e.target.value)} />
                </label>
                <Button type="submit" variant="primary" loading={busy === "budget"} disabled={busy !== null}>
                  Update budget
                </Button>
              </div>
              <GuardLine>
                Large increases are held for approval; changes over your account caps or with the kill switch on are refused.
                {account && (
                  <>
                    {" "}This account: {account.daily_cap_usd ? `${formatUsd(account.daily_cap_usd)}/day` : "no daily cap"}, {account.monthly_cap_usd ? `${formatUsd(account.monthly_cap_usd)}/month` : "no monthly cap"}
                    {account.killswitch ? ", kill switch on." : "."}
                  </>
                )}
              </GuardLine>
            </form>
          </Panel>

          {recent.length > 0 && (
            <section>
              <SectionTitle>Daily</SectionTitle>
              <div className="overflow-hidden rounded-[14px] border border-border bg-card">
                <div className="grid grid-cols-[1fr_repeat(3,minmax(0,5.5rem))] gap-2 border-b border-border px-4 py-2 text-[12px] text-muted-foreground">
                  <span>Day</span>
                  <span className="text-right">Impr.</span>
                  <span className="text-right">Clicks</span>
                  <span className="text-right">Spend</span>
                </div>
                <ul className="divide-y divide-border">
                  {recent.map((m) => (
                    <li key={m.date} className="grid grid-cols-[1fr_repeat(3,minmax(0,5.5rem))] gap-2 px-4 py-2.5 text-[13px] tabular">
                      <span>{new Date(`${m.date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      <span className="text-right text-muted-foreground">{formatCompact(m.impressions)}</span>
                      <span className="text-right text-muted-foreground">{formatCompact(m.clicks)}</span>
                      <span className="text-right">{formatUsd(m.spend_usd)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {campaign.status !== "ended" && (
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-border px-4 py-3">
              <div className="min-w-0">
                <div className="text-[14px] font-medium">End this campaign</div>
                <div className="text-[13px] text-muted-foreground">Stops it for good. Pause instead if you might bring it back.</div>
              </div>
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirm("ended")} disabled={busy !== null}>
                <Square /> End campaign
              </Button>
            </section>
          )}
        </div>
      </PageBody>

      <ConfirmModal
        open={confirm === "active"}
        onClose={() => setConfirm(null)}
        title="Activate this campaign?"
        confirmLabel="Activate"
        busy={busy === "active"}
        onConfirm={() => void onStatus("active")}
      >
        <p>
          It can start spending up to <span className="font-medium text-foreground tabular">{campaign.daily_budget_usd ? `${formatUsd(campaign.daily_budget_usd)}/day` : "its daily budget"}</span> on {account ? platformLabel(account.platform) : "the platform"}.
        </p>
        <p>Activation passes the same spend guard as a budget change. If it's over your approval threshold it waits in your inbox and stays off until you approve. {account?.killswitch && <Badge tone="danger">Kill switch is on: this will be refused</Badge>}</p>
      </ConfirmModal>
      <ConfirmModal open={confirm === "ended"} onClose={() => setConfirm(null)} title="End this campaign?" confirmLabel="End campaign" danger busy={busy === "ended"} onConfirm={() => void onStatus("ended")}>
        <p>Ending stops delivery for good and can't be undone here. Pausing keeps it so you can resume later.</p>
      </ConfirmModal>
    </>
  );
}
