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
import {
  adsKeys,
  connectAccount,
  disconnectAccount,
  refreshAccount,
  type AdAccount,
  type AdPlatform,
} from "@/lib/ads-client";

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

export function ConnectClient({ initial }: { initial: AdAccount[] }) {
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
                    disabled={busy === p.id}
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
                    <li>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onConnect(p.id)}
                        disabled={busy === p.id}
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
