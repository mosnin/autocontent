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
import { Separator } from "@/components/ui/separator";
import { enqueueJobAction } from "@/lib/actions";
import { clientFetch } from "@/lib/client-fetcher";
import { estimateVideoCostUsd } from "@/lib/cost-estimator";
import { formatUsd } from "@/lib/format";
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

  const niche = niches?.find((n) => n.id === args?.nicheId);
  const [submitting, setSubmitting] = React.useState(false);

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

  async function onConfirm() {
    if (!args) return;
    setSubmitting(true);
    const fd = new FormData();
    fd.set("niche_id", args.nicheId);
    fd.set("platform", args.platform);
    const res = await enqueueJobAction({ ok: false }, fd);
    setSubmitting(false);
    if (res.ok) {
      toast.success(`Run enqueued on ${args.platform}`);
      onOpenChange(false);
    } else {
      toast.error(res.error ?? "Failed to enqueue");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Run {niche?.title ?? "niche"} on {args?.platform ?? ""}
          </DialogTitle>
          <DialogDescription>
            We&apos;ll spawn a new pipeline run and post on the niche&apos;s next
            posting window.
          </DialogDescription>
        </DialogHeader>

        {niche && breakdown ? (
          <div className="space-y-3 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">Estimated cost</span>
              <span className="font-mono font-semibold">
                {formatUsd(breakdown.total)}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">Spent today</span>
              <span className="font-mono">{formatUsd(spentToday)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">Daily cap remaining</span>
              <span className="font-mono">{formatUsd(remaining)}</span>
            </div>
            <Separator />
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li className="flex justify-between">
                <span>images ({niche.scene_count})</span>
                <span className="font-mono">{formatUsd(breakdown.image)}</span>
              </li>
              <li className="flex justify-between">
                <span>video</span>
                <span className="font-mono">{formatUsd(breakdown.video)}</span>
              </li>
              <li className="flex justify-between">
                <span>tts</span>
                <span className="font-mono">{formatUsd(breakdown.tts)}</span>
              </li>
              <li className="flex justify-between">
                <span>whisper</span>
                <span className="font-mono">{formatUsd(breakdown.whisper)}</span>
              </li>
              <li className="flex justify-between">
                <span>character sheet</span>
                <span className="font-mono">
                  {formatUsd(breakdown.character_sheet)}
                </span>
              </li>
            </ul>
          </div>
        ) : (
          <div className="flex h-24 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={!niche || submitting}>
            {submitting
              ? "Working…"
              : breakdown
                ? `Run for ${formatUsd(breakdown.total)}`
                : "Run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
