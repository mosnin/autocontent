"use client";

import { Plus, RefreshCw, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppRow, Button, Callout, Card, Column, ConfirmModal, EmptyLine, Field, MenuButton, MenuItem, MoneyInput, Notice, PageHeader, Section, StatusBadge, Switch } from "@/design-system";
import { adsErrorMessage, connectAccount, disconnectAccount, refreshAccount, setGovernance, type AdAccount, type AdPlatform } from "@/lib/ads-client";
import { formatRelative } from "@/lib/format";
import { AccountStatusBadge, accountName, PlatformTile } from "./shared";

const PLATFORMS: { id: AdPlatform; label: string; blurb: string }[] = [
  { id: "google_ads", label: "Google Ads", blurb: "Search, Performance Max and YouTube campaigns" },
  { id: "meta_ads", label: "Meta Ads", blurb: "Facebook and Instagram advertising" },
];

/** Ad accounts (README §5 form, ref 03 rows): connect, refresh, disconnect, and each account's guardrails. */
export function AdAccountsView({ accounts, loadFailed }: { accounts: AdAccount[]; loadFailed?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const connected = accounts.filter((a) => a.status !== "disconnected");

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
      <PageHeader crumbs={[{ label: "Paid media", href: "/paid" }, { label: "Ad accounts" }]} />
      <Column width="md" title="Ad accounts" description="Connecting only grants access. Nothing spends until you set a budget and approve it.">
        {(error || notice || loadFailed) && (
          <div className="space-y-3">
            <Notice ok={notice} error={error} />
            {loadFailed && <Callout>We couldn't load your accounts. Refresh in a moment.</Callout>}
          </div>
        )}

        <Section title="Platforms">
          <div>
            {PLATFORMS.map((p) => {
              const n = connected.filter((a) => a.platform === p.id).length;
              return (
                <AppRow
                  key={p.id}
                  logo={<span className="text-[14px] font-medium">{p.label.slice(0, 1)}</span>}
                  name={p.label}
                  description={n > 0 ? `${n} account${n === 1 ? "" : "s"} connected` : p.blurb}
                  connected={n > 0}
                  onConnect={() => busy === null && void onConnect(p.id)}
                />
              );
            })}
          </div>
        </Section>

        <Section
          title="Guardrails"
          action={
            connected.length > 0 ? (
              <MenuButton
                align="right"
                trigger={() => (
                  <Button size="sm" variant="ghost" loading={busy !== null}>
                    <Plus /> Connect another
                  </Button>
                )}
              >
                {(close) =>
                  PLATFORMS.map((p) => (
                    <MenuItem key={p.id} onClick={() => (close(), void onConnect(p.id))}>
                      {p.label}
                    </MenuItem>
                  ))
                }
              </MenuButton>
            ) : undefined
          }
        >
          {connected.length === 0 ? (
            <EmptyLine>Caps and the kill switch appear here for each connected account.</EmptyLine>
          ) : (
            <div className="space-y-3">
              {connected.map((a) => (
                <AccountCard key={a.id} account={a} />
              ))}
            </div>
          )}
          <p className="mt-3 text-[12px] text-fg-muted">
            Every spend change passes one guard: daily and monthly caps, the kill switch, an account-wide ceiling and approval above your threshold. Each decision is logged on Paid media.
          </p>
        </Section>
      </Column>
    </>
  );
}

function AccountCard({ account: a }: { account: AdAccount }) {
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
    <>
    <Card className="divide-y divide-hairline">
      <div className="flex flex-wrap items-center gap-3 px-3.5 py-3">
        <PlatformTile platform={a.platform} />
        <div className="min-w-0 flex-1 basis-[180px]">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-[13.5px] font-medium">{accountName(a)}</span>
            <AccountStatusBadge status={a.status} />
            {a.killswitch && <StatusBadge tone="negative">Kill switch on</StatusBadge>}
          </div>
          <div className="truncate text-[12px] text-fg-muted">
            <span className="font-mono">{a.external_account_id || "—"}</span> · {a.currency} · updated {formatRelative(a.updated_at)}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => void run("refresh", () => refreshAccount(a.id), "Status refreshed.")} loading={busy === "refresh"} disabled={busy !== null} aria-label="Refresh status">
            <RefreshCw /> <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm("disconnect")} disabled={busy !== null} aria-label="Disconnect">
            <Unplug /> <span className="hidden sm:inline">Disconnect</span>
          </Button>
        </div>
      </div>
      {a.last_error && (
        <div className="px-3.5 py-2.5">
          <Notice error={a.last_error} />
        </div>
      )}

      <div className="flex items-center justify-between gap-4 px-3.5 py-3">
        <div className="min-w-0">
          <div className="text-[13px]">Kill switch</div>
          <div className="text-[12px] text-fg-muted">Stops every spend change and activation on this account, immediately.</div>
        </div>
        <Switch
          checked={a.killswitch}
          label="Kill switch"
          disabled={busy !== null}
          onChange={(v) => (v ? void run("kill", () => setGovernance(a.id, { killswitch: true }), "Kill switch on. Nothing on this account can spend more.") : setConfirm("kill-off"))}
        />
      </div>

      <div className="px-3.5 py-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Daily cap">
            <MoneyInput value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="No cap" aria-label={`Daily cap for ${accountName(a)}`} />
          </Field>
          <Field label="Monthly cap">
            <MoneyInput value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="No cap" aria-label={`Monthly cap for ${accountName(a)}`} />
          </Field>
          <Button
            variant="primary"
            disabled={!capsDirty || busy !== null}
            loading={busy === "caps"}
            onClick={() => void run("caps", () => setGovernance(a.id, { daily_cap_usd: daily.trim() || null, monthly_cap_usd: monthly.trim() || null }), "Caps saved.")}
          >
            Save caps
          </Button>
        </div>
        <p className="mt-2 text-[12px] text-fg-muted">Leave a cap empty for none. Changes are audited.</p>
        {note && (
          <div className="mt-2">
            <Notice ok={note.ok} error={note.error} />
          </div>
        )}
      </div>
    </Card>

      <ConfirmModal open={confirm === "disconnect"} onClose={() => setConfirm(null)} title={`Disconnect ${accountName(a)}?`} confirmLabel="Disconnect" danger busy={busy === "disconnect"} onConfirm={() => void run("disconnect", () => disconnectAccount(a.id), "Disconnected.")}>
        <p>Marketer loses access to this account. Campaigns already running keep running on the platform until you stop them there.</p>
      </ConfirmModal>
      <ConfirmModal open={confirm === "kill-off"} onClose={() => setConfirm(null)} title="Turn off the kill switch?" confirmLabel="Turn off" busy={busy === "kill"} onConfirm={() => void run("kill", () => setGovernance(a.id, { killswitch: false }), "Kill switch off. Spend changes go through your caps and approvals again.")}>
        <p>Spend changes and activations on this account will be allowed again, still inside your caps and approval threshold.</p>
      </ConfirmModal>
    </>
  );
}
