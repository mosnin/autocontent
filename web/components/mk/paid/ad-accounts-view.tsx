"use client";

import { Megaphone, Plus, RefreshCw, Unplug } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { adsErrorMessage, connectAccount, disconnectAccount, refreshAccount, setGovernance, type AdAccount, type AdPlatform } from "@/lib/ads-client";
import { formatRelative } from "@/lib/format";
import { Crumbs, PageBody, PageHeader, PageIntro, Panel } from "../page";
import { Badge, Button, ErrorText, Switch } from "../ui";
import { ConfirmModal, MoneyInput, SaveNote } from "../settings/primitives";
import { AccountStatusBadge, accountName, GuardLine, PlatformTile } from "./shared";

const PLATFORMS: { id: AdPlatform; label: string; blurb: string }[] = [
  { id: "google_ads", label: "Google Ads", blurb: "Search, Performance Max and YouTube campaigns." },
  { id: "meta_ads", label: "Meta Ads", blurb: "Facebook and Instagram advertising." },
];

/** Ad accounts: connect via Composio, refresh, disconnect, and each account's guardrails. */
export function AdAccountsView({ accounts, loadFailed }: { accounts: AdAccount[]; loadFailed?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onConnect(platform: AdPlatform) {
    setBusy(platform);
    setError(null);
    try {
      const { redirect_url } = await connectAccount(platform);
      if (redirect_url) {
        window.location.href = redirect_url; // the platform's OAuth consent screen
        return;
      }
      setNotice("Connection started. Refresh the account to check its status.");
      router.refresh();
    } catch (e) {
      setError(adsErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader icon={<Megaphone />} title={<Crumbs items={[<Link key="p" href="/paid" className="hover:text-foreground">Paid media</Link>, "Ad accounts"]} />} />
      <PageBody width="4xl">
        <PageIntro title="Ad accounts and guardrails">
          Connect a platform so the Media buyer can run campaigns for you. Connecting only grants access: nothing spends until you set a budget and approve it.
        </PageIntro>
        <div className="t-stagger space-y-5">
          <ErrorText error={error} />
          {notice && <SaveNote ok={notice} />}
          {loadFailed && <p className="rounded-[14px] bg-subtle px-4 py-3 text-[13px] text-muted-foreground">We couldn't load your accounts right now. Refresh in a moment.</p>}
          {PLATFORMS.map((p) => {
            const conns = accounts.filter((a) => a.platform === p.id && a.status !== "disconnected");
            return (
              <Panel
                key={p.id}
                label={p.label}
                action={
                  conns.length > 0 ? (
                    <Button size="sm" variant="ghost" onClick={() => void onConnect(p.id)} loading={busy === p.id}>
                      <Plus /> Connect another
                    </Button>
                  ) : undefined
                }
                bodyClassName="!p-0"
              >
                {conns.length === 0 ? (
                  <div className="flex flex-wrap items-center gap-3 px-5 py-4">
                    <PlatformTile platform={p.id} size={36} />
                    <div className="min-w-0 flex-1 basis-[200px]">
                      <div className="text-[14px] font-medium">{p.label}</div>
                      <div className="text-[13px] text-muted-foreground">{p.blurb}</div>
                    </div>
                    <Button variant="primary" onClick={() => void onConnect(p.id)} loading={busy === p.id}>
                      Connect {p.label}
                    </Button>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {conns.map((a) => (
                      <AccountRow key={a.id} account={a} />
                    ))}
                  </div>
                )}
              </Panel>
            );
          })}
          <GuardLine>
            Every spend change goes through one guard: per-account daily and monthly caps, the kill switch, an account-wide budget ceiling and approval above your threshold. Each decision lands in the audit trail on Paid media.
          </GuardLine>
        </div>
      </PageBody>
    </>
  );
}

function AccountRow({ account: a }: { account: AdAccount }) {
  const router = useRouter();
  const [daily, setDaily] = useState(a.daily_cap_usd ?? "");
  const [monthly, setMonthly] = useState(a.monthly_cap_usd ?? "");
  const [busy, setBusy] = useState<"refresh" | "disconnect" | "caps" | "kill" | null>(null);
  const [note, setNote] = useState<{ ok?: string; error?: string } | null>(null);
  const [confirm, setConfirm] = useState<"disconnect" | "kill-off" | null>(null);

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<unknown>, ok: string) => {
    setBusy(kind);
    setNote(null);
    try {
      await fn();
      setNote({ ok });
      setConfirm(null);
      router.refresh();
    } catch (e) {
      setNote({ error: adsErrorMessage(e) });
      setConfirm(null);
    } finally {
      setBusy(null);
    }
  };

  const capsDirty = (daily || null) !== (a.daily_cap_usd ?? null) || (monthly || null) !== (a.monthly_cap_usd ?? null);

  return (
    <div className="space-y-4 px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <PlatformTile platform={a.platform} />
        <div className="min-w-0 flex-1 basis-[160px]">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[14px] font-medium">{accountName(a)}</span>
            <AccountStatusBadge status={a.status} />
            {a.killswitch && <Badge tone="danger">Kill switch on</Badge>}
          </div>
          <div className="truncate text-[13px] text-muted-foreground">
            <span className="font-mono text-[12px]">{a.external_account_id || "—"}</span> · {a.currency} · updated {formatRelative(a.updated_at)}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => void run("refresh", () => refreshAccount(a.id), "Status refreshed.")} loading={busy === "refresh"} disabled={busy !== null} aria-label="Refresh status">
            <RefreshCw /> <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button size="sm" variant="ghost" className="hover:text-destructive" onClick={() => setConfirm("disconnect")} disabled={busy !== null} aria-label="Disconnect">
            <Unplug /> <span className="hidden sm:inline">Disconnect</span>
          </Button>
        </div>
      </div>
      {a.last_error && <p className="rounded-lg bg-destructive/[0.06] px-3 py-2 text-[13px] text-destructive">{a.last_error}</p>}

      <div className="rounded-[14px] bg-subtle p-4 shadow-[inset_0_0_0_1px_hsl(var(--border))]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[14px] font-medium">Kill switch</div>
            <div className="text-[13px] text-muted-foreground">On stops every spend change and activation on this account, by anyone, immediately.</div>
          </div>
          <Switch
            checked={a.killswitch}
            label="Kill switch"
            onChange={(v) => (v ? void run("kill", () => setGovernance(a.id, { killswitch: true }), "Kill switch on. Nothing on this account can spend more.") : setConfirm("kill-off"))}
          />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="block space-y-1.5">
            <span className="text-[13px] font-medium">Daily cap</span>
            <MoneyInput value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="No cap" aria-label={`Daily cap for ${accountName(a)}`} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[13px] font-medium">Monthly cap</span>
            <MoneyInput value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="No cap" aria-label={`Monthly cap for ${accountName(a)}`} />
          </label>
          <Button
            variant="primary"
            disabled={!capsDirty || busy !== null}
            loading={busy === "caps"}
            onClick={() => void run("caps", () => setGovernance(a.id, { daily_cap_usd: daily.trim() || null, monthly_cap_usd: monthly.trim() || null }), "Caps saved.")}
          >
            Save caps
          </Button>
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">Leave a cap empty for none. Changes are audited.</p>
      </div>
      {note && <SaveNote ok={note.ok} error={note.error} />}

      <ConfirmModal open={confirm === "disconnect"} onClose={() => setConfirm(null)} title={`Disconnect ${accountName(a)}?`} confirmLabel="Disconnect" danger busy={busy === "disconnect"} onConfirm={() => void run("disconnect", () => disconnectAccount(a.id), "Disconnected.")}>
        <p>Marketer loses access to this account. Campaigns already running on the platform keep running there until you stop them in the platform itself.</p>
      </ConfirmModal>
      <ConfirmModal open={confirm === "kill-off"} onClose={() => setConfirm(null)} title="Turn off the kill switch?" confirmLabel="Turn off" busy={busy === "kill"} onConfirm={() => void run("kill", () => setGovernance(a.id, { killswitch: false }), "Kill switch off. Spend changes go through your caps and approvals again.")}>
        <p>Spend changes and activations on this account will be allowed again, still inside your caps and approval threshold.</p>
      </ConfirmModal>
    </div>
  );
}
