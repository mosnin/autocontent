"use client";

// One Ad Run: the Brief the plan was built from, then the gallery.
//
// The Brief is shown because it is the auditable part - the brand facts,
// palette, and mood the copy and artwork were derived from. If an ad looks
// wrong, this is where you find out why before re-running anything.

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { clientFetch } from "@/lib/client-fetcher";
import {
  adCreativeKeys,
  isRunActive,
  isSlotPending,
  retryAdSlot,
  type AdRunDetail,
  type AdSlot,
} from "@/lib/ad-creatives-client";
import { AdRunGallery, RunStatusBadge } from "../AdCreativesClient";

const POLL_MS = 8_000;

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

export function AdRunDetailClient({ initial }: { initial: AdRunDetail }) {
  const { data, mutate } = useSWR<AdRunDetail>(
    adCreativeKeys.run(initial.run.id),
    clientFetch,
    {
      fallbackData: initial,
      refreshInterval: (latest) =>
        latest && (isRunActive(latest.run) || latest.slots.some(isSlotPending))
          ? POLL_MS
          : 0,
    },
  );
  const detail = data ?? initial;
  const { run, slots } = detail;
  const brief = run.brief ?? {};
  const colors = brief.colors ?? [];

  const [nonce, setNonce] = React.useState(0);
  const [busySlot, setBusySlot] = React.useState<string | null>(null);

  async function retry(slot: AdSlot) {
    setBusySlot(slot.id);
    try {
      await retryAdSlot(run.id, slot.id);
      toast.success("Re-rendering that slot");
      setNonce((n) => n + 1);
      await mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setBusySlot(null);
    }
  }

  const rendered = slots.filter((s) => s.status === "done").length;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href="/ad-creatives"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← Ad studio
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {run.brand_name || run.domain}
          </h1>
          <RunStatusBadge status={run.status} />
          {slots.length > 0 ? (
            <span className="font-mono text-xs text-muted-foreground">
              {rendered}/{slots.length} rendered
            </span>
          ) : null}
        </div>
        <p className="font-mono text-xs text-muted-foreground">{run.domain}</p>
      </div>

      {run.error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {run.error}
        </p>
      ) : null}

      {brief.brand_name || brief.mood || colors.length > 0 ? (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div>
              <h2 className="text-sm font-semibold">The brief</h2>
              <p className="text-xs text-muted-foreground">
                Extracted from the public site. Everything below fed the plan.
              </p>
            </div>
            <Separator />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Fact label="Industry" value={brief.industry} />
              <Fact label="Mood" value={brief.mood} />
              <Fact label="Typeface" value={brief.font_family} />
              <Fact
                label="Prompt colors"
                value={
                  brief.color_a || brief.color_b
                    ? [brief.color_a, brief.color_b].filter(Boolean).join(" · ")
                    : null
                }
              />
            </div>
            {brief.summary ? (
              <p className="text-sm text-muted-foreground">{brief.summary}</p>
            ) : null}
            {colors.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                {colors.map((c) => (
                  <span
                    key={`${c.hex}-${c.name ?? ""}`}
                    className="flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px]"
                  >
                    <span
                      aria-hidden
                      className="size-3 rounded-full border border-border"
                      style={{ backgroundColor: c.hex }}
                    />
                    <span className="font-mono text-muted-foreground">{c.hex}</span>
                    {c.name ? <span>{c.name}</span> : null}
                  </span>
                ))}
              </div>
            ) : null}
            {brief.logo_url ? (
              <Badge variant="outline" className="max-w-full text-[11px]">
                <span className="truncate">logo: {brief.logo_url}</span>
              </Badge>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Gallery</h2>
        <AdRunGallery
          runId={run.id}
          slots={slots}
          nonce={nonce}
          onRetry={retry}
          busySlot={busySlot}
        />
      </section>
    </div>
  );
}
