"use client";

// Global run-confirmation dialog.
//
// A small React context exposes `openRunConfirm({ nicheId, platform })`
// to anywhere in the tree; the dashboard's run buttons and the
// command palette both call it. Mount <RunConfirmProvider> once near
// the app root.

import * as React from "react";
import useSWR from "swr";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { enqueueJobAction } from "@/lib/actions";
import { clientFetch } from "@/lib/client-fetcher";
import { estimateVideoCostUsd } from "@/lib/cost-estimator";
import { extractDetail, isCreditError } from "@/lib/errors";
import { formatUsd } from "@/lib/format";
import { platformLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { Niche, Platform, TodaySpend } from "@/lib/types";

interface OpenArgs {
  nicheId: string;
  platform: Platform;
}


interface Ctx {
  openRunConfirm: (args: OpenArgs) => void;
}

const RunConfirmContext = React.createContext<Ctx | null>(null);

export function useRunConfirm(): Ctx {
  const ctx = React.useContext(RunConfirmContext);
  if (!ctx) {
    throw new Error("useRunConfirm must be used inside <RunConfirmProvider>");
  }
  return ctx;
}

export function RunConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [args, setArgs] = React.useState<OpenArgs | null>(null);

  const openRunConfirm = React.useCallback((next: OpenArgs) => {
    setArgs(next);
    setOpen(true);
  }, []);

  const value = React.useMemo(() => ({ openRunConfirm }), [openRunConfirm]);

  return (
    <RunConfirmContext.Provider value={value}>
      {children}
      <RunConfirmDialog open={open} onOpenChange={setOpen} args={args} />
    </RunConfirmContext.Provider>
  );
}

// Verbatim recording indicator — a brand dot with a slow ping halo.
function RecordingDot() {
  return (
    <span aria-hidden className="relative flex size-2">
      <span className="relative inline-flex size-2 rounded-full bg-brand" />
    </span>
  );
}

function RunConfirmDialog({
  open,
  onOpenChange,
  args,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  args: OpenArgs | null;
}) {
  // Only fetch while we actually have something to confirm; the SWR
  // key flips to null otherwise so we don't poll on mount.
  const enabled = open && !!args;
  const { data: niches } = useSWR<Niche[]>(
    enabled ? "/api/v1/niches" : null,
    clientFetch,
  );
  const { data: spend } = useSWR<TodaySpend>(
    enabled ? "/api/v1/spend/today" : null,
    clientFetch,
  );
  // Hosted deploys bill at cost × margin — the button must show the number
  // that will actually hit the balance, not the raw provider cost.
  const { data: billing } = useSWR<{ billing_enabled: boolean; margin: number }>(
    enabled ? "/api/v1/billing/balance" : null,
    clientFetch,
  );
  const margin = billing?.billing_enabled ? billing.margin : 1;

  const niche = niches?.find((n) => n.id === args?.nicheId);
  const [submitting, setSubmitting] = React.useState(false);
  const [creditError, setCreditError] = React.useState<string | null>(null);

  // A fresh open is a fresh decision — don't carry a stale refusal over.
  React.useEffect(() => {
    if (open) setCreditError(null);
  }, [open, args?.nicheId, args?.platform]);

  const breakdown = niche
    ? estimateVideoCostUsd({
        scene_count: niche.scene_count,
        image_quality: niche.image_quality,
        video_resolution: niche.video_resolution,
        scene_max_duration_sec: niche.scene_max_duration_sec,
        target_duration_sec: niche.target_duration_sec,
      })
    : null;

  const spentToday = niche && spend ? Number(spend.by_niche[niche.id] ?? "0") : 0;
  const cap = niche ? Number(niche.daily_spend_cap_usd) : 0;
  const remaining = Math.max(0, cap - spentToday);
  const usedPct = cap > 0 ? Math.min(100, (spentToday / cap) * 100) : 0;

  // "Tight" = this run would eat most/all of what's left of the daily cap.
  // We surface that in brand orange so the operator sees it before spending.
  const tight =
    !!breakdown && cap > 0 && breakdown.total > remaining - breakdown.total;
  const overCap = !!breakdown && cap > 0 && breakdown.total > remaining;

  async function onConfirm() {
    if (!args) return;
    setSubmitting(true);
    const fd = new FormData();
    fd.set("niche_id", args.nicheId);
    fd.set("platform", args.platform);
    const res = await enqueueJobAction({ ok: false }, fd);
    setSubmitting(false);
    if (res.ok) {
      toast.success(`Run started — ${platformLabel(args.platform)}`);
      onOpenChange(false);
    } else if (isCreditError(res.error)) {
      // Out of credit: keep the dialog open and offer the fix, instead of
      // toasting a raw status line. The server message is human-written.
      setCreditError(extractDetail(res.error) ?? "You're out of credit for this run.");
    } else {
      toast.error(res.error ?? "Failed to enqueue");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
            Confirm run
          </p>
          <DialogTitle>
            Run {niche?.title ?? "channel"} on {args ? platformLabel(args.platform) : ""}
          </DialogTitle>
          <DialogDescription>
            We&apos;ll produce a new video and post it in this channel&apos;s next
            posting window.
          </DialogDescription>
        </DialogHeader>

        {niche && breakdown ? (
          <div className="space-y-5">
            {/* Headline cost */}
            <div className="rounded-lg border border-border/60 bg-card/40 p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">
                  Estimated cost
                </span>
                <span className="font-mono text-2xl font-semibold tabular-nums">
                  {formatUsd(breakdown.total * margin)}
                </span>
              </div>

              {/* Today's spend vs cap */}
              <div className="mt-4 space-y-1.5">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-muted-foreground">
                    Today · {formatUsd(spentToday)} of {formatUsd(cap)}
                  </span>
                  <span
                    className={cn(
                      "font-mono tabular-nums",
                      tight ? "text-brand" : "text-muted-foreground",
                    )}
                  >
                    {formatUsd(remaining)} left
                  </span>
                </div>
                <Progress
                  value={usedPct}
                  className={
                    tight ? "**:data-[slot=progress-range]:bg-brand" : undefined
                  }
                />
                {overCap ? (
                  <p className="text-xs text-brand">
                    This run exceeds the remaining daily cap.
                  </p>
                ) : null}
              </div>
            </div>

            {/* Line-item breakdown */}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">
                Breakdown
              </p>
              <Separator />
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li className="flex justify-between">
                  <span>images ({niche.scene_count})</span>
                  <span className="font-mono tabular-nums">
                    {formatUsd(breakdown.image)}
                  </span>
                </li>
                <li className="flex justify-between">
                  <span>video</span>
                  <span className="font-mono tabular-nums">
                    {formatUsd(breakdown.video)}
                  </span>
                </li>
                <li className="flex justify-between">
                  <span>tts</span>
                  <span className="font-mono tabular-nums">
                    {formatUsd(breakdown.tts)}
                  </span>
                </li>
                <li className="flex justify-between">
                  <span>whisper</span>
                  <span className="font-mono tabular-nums">
                    {formatUsd(breakdown.whisper)}
                  </span>
                </li>
                <li className="flex justify-between">
                  <span>character sheet</span>
                  <span className="font-mono tabular-nums">
                    {formatUsd(breakdown.character_sheet)}
                  </span>
                </li>
                {margin > 1 && (
                  <li className="flex justify-between">
                    <span>billing margin (+{Math.round((margin - 1) * 100)}%)</span>
                    <span className="font-mono tabular-nums">
                      {formatUsd(breakdown.total * (margin - 1))}
                    </span>
                  </li>
                )}
              </ul>
            </div>
          </div>
        ) : (
          <div className="flex h-24 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {creditError && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-sm">{creditError}</p>
            <Button asChild size="sm" className="shrink-0">
              <a href="/settings/billing">Add credit</a>
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={!niche || submitting}>
            {submitting ? (
              <>
                <RecordingDot />
                Working…
              </>
            ) : breakdown ? (
              `Run for ${formatUsd(breakdown.total * margin)}`
            ) : (
              "Run"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
