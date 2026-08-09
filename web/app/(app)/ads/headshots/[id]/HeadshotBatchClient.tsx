"use client";

// One headshot batch: the portraits, plus the art direction they were made
// with and the reference photos they were made from.
//
// Variant state is per-portrait because the batch is N independent charges:
// 'partial' means some landed and some didn't, and the ones that landed are
// real. Retry re-renders only the gaps.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";

import { Badge } from "@/components/square/ui/badge";
import { Button } from "@/components/square/ui/button";
import { Card, CardContent } from "@/components/square/ui/card";
import { Skeleton } from "@/components/square/ui/skeleton";
import { clientFetch } from "@/lib/client-fetcher";
import { cn } from "@/lib/utils";
import {
  canRetryBatch,
  deleteHeadshotBatch,
  headshotKeys,
  headshotSourceImageUrl,
  headshotVariantImageUrl,
  isBatchActive,
  isVariantPending,
  readableError,
  retryHeadshotBatch,
  type HeadshotBatchDetail,
  type HeadshotStyle,
} from "@/lib/headshots-client";
import { BatchStatusBadge } from "../HeadshotsClient";

const POLL_MS = 6_000;

export function HeadshotBatchClient({
  initial,
  styles,
}: {
  initial: HeadshotBatchDetail;
  styles: HeadshotStyle[];
}) {
  const router = useRouter();
  const { data, mutate } = useSWR<HeadshotBatchDetail>(
    headshotKeys.batch(initial.batch.id),
    clientFetch,
    {
      fallbackData: initial,
      refreshInterval: (latest) =>
        latest && (isBatchActive(latest.batch) || latest.variants.some(isVariantPending))
          ? POLL_MS
          : 0,
    },
  );
  const detail = data ?? initial;
  const { batch, variants } = detail;
  const style = styles.find((s) => s.key === batch.style_key);
  const delivered = variants.filter((v) => v.status === "done").length;

  const [nonce, setNonce] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  async function retry() {
    setBusy(true);
    try {
      await retryHeadshotBatch(batch.id);
      toast.success("Re-rendering the missing portraits");
      setNonce((n) => n + 1);
      await mutate();
    } catch (err) {
      toast.error(readableError(err, "Retry failed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      await deleteHeadshotBatch(batch.id);
      toast.success("Batch deleted");
      router.push("/ads/headshots");
    } catch (err) {
      toast.error(readableError(err, "Delete failed"));
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href="/ads/headshots"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← Headshot studio
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {style?.label ?? batch.style_key}
          </h1>
          <BatchStatusBadge status={batch.status} />
          <span className="font-mono text-xs text-muted-foreground">
            {delivered}/{batch.variant_count} delivered
          </span>
          {canRetryBatch(batch) ? (
            <Button size="sm" disabled={busy} onClick={() => void retry()}>
              {busy ? "…" : "Render the missing ones"}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className="text-xs"
            disabled={deleting}
            onClick={() => void remove()}
          >
            {deleting ? "…" : "Delete batch"}
          </Button>
        </div>
        {batch.subject_notes ? (
          <p className="max-w-3xl text-sm text-muted-foreground">
            Subject notes: {batch.subject_notes}
          </p>
        ) : null}
      </div>

      {batch.error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {batch.error}
        </p>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Portraits</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {variants.map((v) => (
            <Card
              key={v.id}
              className={cn(
                "gap-0 overflow-hidden rounded-lg border bg-card py-0",
                v.status === "failed" && "border-destructive/50",
              )}
            >
              <div className="relative aspect-square w-full bg-muted">
                {v.status === "done" && v.has_image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={headshotVariantImageUrl(batch.id, v.id, nonce)}
                    alt={`Portrait ${v.variant_index + 1}`}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : isVariantPending(v) ? (
                  <>
                    <Skeleton className="h-full w-full rounded-none" />
                    <span className="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground">
                      {v.status === "running" ? "Rendering…" : "Queued"}
                    </span>
                  </>
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-3 text-center">
                    <p className="text-xs font-medium text-destructive">
                      {v.status === "cancelled" ? "Not rendered" : "Failed"}
                    </p>
                    {v.error ? (
                      <p
                        className="line-clamp-4 text-[11px] text-muted-foreground"
                        title={v.error}
                      >
                        {v.error}
                      </p>
                    ) : v.status === "cancelled" ? (
                      <p className="text-[11px] text-muted-foreground">
                        Stopped before it was charged.
                      </p>
                    ) : null}
                  </div>
                )}
                <span className="absolute left-2 top-2">
                  <Badge
                    variant="outline"
                    className="bg-background/85 font-mono text-[10px] backdrop-blur"
                  >
                    #{v.variant_index + 1}
                  </Badge>
                </span>
              </div>
            </Card>
          ))}
        </div>
        {canRetryBatch(batch) ? (
          <p className="text-xs text-muted-foreground">
            Retry re-renders only the variants with nothing to show — the
            portraits above are never bought twice.
          </p>
        ) : null}
      </section>

      {batch.source_image_ids.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Reference photos</h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {batch.source_image_ids.map((sid, i) => (
              <div key={sid} className="overflow-hidden rounded-lg border bg-muted">
                <div className="aspect-square w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={headshotSourceImageUrl(sid)}
                    alt={`Reference ${i + 1}`}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            A deleted reference photo shows as a blank tile; the portraits it
            already produced are unaffected.
          </p>
        </section>
      ) : null}

      {style ? (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <h2 className="text-sm font-semibold">Art direction</h2>
            <p className="text-xs text-muted-foreground">{style.description}</p>
            <dl className="grid gap-3 pt-1 sm:grid-cols-2">
              {(
                [
                  ["Wardrobe", style.wardrobe],
                  ["Lighting", style.lighting],
                  ["Background", style.background],
                  ["Lens", style.lens],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="space-y-0.5">
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {label}
                  </dt>
                  <dd className="text-xs">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
