"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { RefreshCw, Unplug } from "lucide-react";

import { Badge } from "@/components/square/ui/badge";
import { Button } from "@/components/square/ui/button";
import { Card, CardContent } from "@/components/square/ui/card";
import { cn } from "@/lib/utils";
import { clientFetch } from "@/lib/client-fetcher";
import { Input } from "@/components/square/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  adsKeys,
  connectAccount,
  disconnectAccount,
  refreshAccount,
  setGovernance,
  type AdAccount,
  type AdPlatform,
} from "@/lib/ads-client";
import { formatUsd } from "@/lib/format";
import { toastActionError } from "@/lib/errors";

const PLATFORMS: { id: AdPlatform; label: string; blurb: string }[] = [
  {
    id: "google_ads",
    label: "Google Ads",
    blurb: "Search, Performance Max, and YouTube campaigns.",
  },
  {
    id: "meta_ads",
    label: "Meta Ads",
    blurb: "Facebook and Instagram advertising.",
  },
];

// Template badge tone technique (square Badge has no
// success/warning/destructive-tint variants of its own) — same
// outline + tonal bg/text/border classes used across the ads pages.
function statusTone(status: string): { label: string; className: string } {
  switch (status) {
    case "active":
      return {
        label: "Connected",
        className:
          "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900",
      };
    case "pending":
      return {
        label: "Authorizing",
        className:
          "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-amber-200 dark:border-amber-900",
      };
    case "error":
      return {
        label: "Error",
        className:
          "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400 border-rose-200 dark:border-rose-900",
      };
    default:
      return {
        label: "Disconnected",
        className: "border text-muted-foreground bg-transparent",
      };
  }
}

export function ConnectClient({
  initial,
  adsEnabled = null,
}: {
  initial: AdAccount[];
  adsEnabled?: boolean | null;
}) {
  const { data, mutate } = useSWR<AdAccount[]>(adsKeys.accounts(), clientFetch, {
    fallbackData: initial,
  });
  const accounts = data ?? [];
  const [busy, setBusy] = React.useState<string | null>(null);

  const byPlatform = (p: AdPlatform) =>
    accounts.filter((a) => a.platform === p && a.status !== "disconnected");

  async function onConnect(platform: AdPlatform) {
    setBusy(platform);
    try {
      const { redirect_url } = await connectAccount(platform);
      if (redirect_url) {
        // Hand off to the platform's OAuth consent screen.
        window.location.href = redirect_url;
      } else {
        toast.message("Connection started — refresh to check status.");
        void mutate();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Connect failed";
      toast.error(
        msg.includes("409")
          ? "Ads isn't enabled on this workspace yet."
          : msg,
      );
    } finally {
      setBusy(null);
    }
  }

  async function onRefresh(id: string) {
    setBusy(id);
    try {
      await refreshAccount(id);
      void mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setBusy(null);
    }
  }

  async function onDisconnect(id: string) {
    setBusy(id);
    try {
      await disconnectAccount(id);
      toast.success("Disconnected");
      void mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ad accounts</h1>
        <p className="text-sm text-muted-foreground">
          Connect a platform so agents can run campaigns on your behalf.
          Connecting only grants access — nothing spends until you set a budget
          and approve it.
        </p>
      </div>

      {adsEnabled === false && (
        <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Ads isn&apos;t enabled on this workspace yet — connecting is off
          until an administrator turns it on.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {PLATFORMS.map((p) => {
          const conns = byPlatform(p.id);
          return (
            <Card key={p.id}>
              <CardContent className="space-y-4 pt-5">
                <div>
                  <h2 className="text-base font-semibold">{p.label}</h2>
                  <p className="text-sm text-muted-foreground">{p.blurb}</p>
                </div>

                {conns.length === 0 ? (
                  <Button
                    onClick={() => onConnect(p.id)}
                    disabled={busy === p.id || adsEnabled === false}
                    className="w-full"
                  >
                    {busy === p.id ? "…" : `Connect ${p.label}`}
                  </Button>
                ) : (
                  <ul className="space-y-2">
                    {conns.map((a) => {
                      const tone = statusTone(a.status);
                      return (
                        <li
                          key={a.id}
                          className="flex items-center gap-2 rounded-lg border bg-card p-2.5"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {a.name || a.external_account_id || "Account"}
                          </span>
                          <Badge
                            variant="outline"
                            className={cn("text-xs font-medium px-2 py-0.5", tone.className)}
                          >
                            {tone.label}
                          </Badge>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Refresh status"
                            disabled={busy === a.id}
                            onClick={() => onRefresh(a.id)}
                          >
                            <RefreshCw className="size-3.5" aria-hidden />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Disconnect"
                            disabled={busy === a.id}
                            onClick={() => onDisconnect(a.id)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Unplug className="size-3.5" aria-hidden />
                          </Button>
                        </li>
                      );
                    })}
                    {conns.map((a) => {
                      return (
                        <li key={`${a.id}-governance`}>
                          <GuardrailsEditor key={`${a.id}-${a.updated_at}`} account={a} onSaved={() => void mutate()} />
                        </li>
                      );
                    })}
                    <li>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onConnect(p.id)}
                        disabled={busy === p.id || adsEnabled === false}
                      >
                        {busy === p.id ? "…" : "Connect another"}
                      </Button>
                    </li>
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The guardrails, finally visible where the account lives: daily/monthly
 * caps and the kill-switch — the controls the fail-closed guard enforces.
 * Every denial the guard issues cites numbers the user can now see and set.
 */
function GuardrailsEditor({
  account,
  onSaved,
}: {
  account: AdAccount;
  onSaved: () => void;
}) {
  const [daily, setDaily] = React.useState(account.daily_cap_usd ?? "");
  const [monthly, setMonthly] = React.useState(account.monthly_cap_usd ?? "");
  const [kill, setKill] = React.useState(account.killswitch);
  const [saving, setSaving] = React.useState(false);

  async function save() {
    setSaving(true);
    try {
      await setGovernance(account.id, {
        daily_cap_usd: daily.trim() === "" ? null : daily.trim(),
        monthly_cap_usd: monthly.trim() === "" ? null : monthly.trim(),
        killswitch: kill,
      });
      toast.success("Guardrails updated");
      onSaved();
    } catch (e) {
      toastActionError(e instanceof Error ? e.message : undefined, "Couldn't save guardrails");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-dashed bg-card/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">
          Spending guardrails
          {(account.name || account.external_account_id) && (
            <span className="ml-1 normal-case tracking-normal">
              · {account.name || account.external_account_id}
            </span>
          )}
        </p>
        <label className="flex items-center gap-2 text-xs font-medium">
          Kill-switch
          <Switch checked={kill} onCheckedChange={setKill} aria-label="Kill-switch" />
        </label>
      </div>
      {kill && (
        <p className="mt-1 text-xs text-destructive">
          Kill-switch on — every spend-affecting change on this account is
          refused until you turn it off.
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="text-xs text-muted-foreground">
          Daily cap (USD)
          <Input
            className="mt-1"
            inputMode="decimal"
            placeholder="No cap"
            value={daily}
            onChange={(e) => setDaily(e.target.value)}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Monthly cap (USD)
          <Input
            className="mt-1"
            inputMode="decimal"
            placeholder="No cap"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
          />
        </label>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {account.daily_cap_usd || account.monthly_cap_usd
            ? [
                account.daily_cap_usd && `${formatUsd(account.daily_cap_usd)}/day`,
                account.monthly_cap_usd && `${formatUsd(account.monthly_cap_usd)}/month`,
              ]
                .filter(Boolean)
                .join(" · ")
                .replace(/^/, "Enforced: ")
            : "No caps set — only the kill-switch protects this account."}
        </p>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save guardrails"}
        </Button>
      </div>
    </div>
  );
}
