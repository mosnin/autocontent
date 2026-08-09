"use client";

// Ad Creative Studio: a public domain in, a gallery of on-brand 1:1 ads out.
//
// The gallery is the product, so this page leads with the newest run's
// rendered slots (each one a distinct Creative Direction on a distinct image
// model) rather than with a table of ids. Past runs stay tabular underneath,
// following the ApprovalsClient / campaigns-table anatomy.
//
// Polling only runs while something is actually in flight — a finished run is
// a static page and a permanent 20s poll on it is pure waste.

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";

import { Badge } from "@/components/square/ui/badge";
import { Button } from "@/components/square/ui/button";
import { Card, CardContent } from "@/components/square/ui/card";
import { Input } from "@/components/square/ui/input";
import { Skeleton } from "@/components/square/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/square/ui/table";
import { clientFetch } from "@/lib/client-fetcher";
import { cn } from "@/lib/utils";
import type { Niche } from "@/lib/types";
import {
  adCreativeKeys,
  adSlotImageUrl,
  createAdRun,
  isNotConfigured,
  isRunActive,
  isSlotPending,
  retryAdSlot,
  type AdRun,
  type AdRunDetail,
  type AdRunStatus,
  type AdSlot,
  type AdSlotStatus,
} from "@/lib/ad-creatives-client";

const POLL_MS = 8_000;

// ------------------------------------------------------------------ badges

const RUN_TONE: Record<AdRunStatus, string> = {
  queued: "border text-muted-foreground bg-transparent",
  planning: "border-brand/50 text-brand bg-transparent",
  rendering: "border-brand/50 text-brand bg-transparent",
  done: "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400",
  failed:
    "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400",
};

export function RunStatusBadge({ status }: { status: AdRunStatus }) {
  const live = status === "planning" || status === "rendering";
  return (
    <Badge variant="outline" className={cn("gap-1.5 font-mono text-xs", RUN_TONE[status])}>
      {live && <span aria-hidden className="size-2 animate-pulse rounded-full bg-brand" />}
      {status}
    </Badge>
  );
}

const SLOT_TONE: Record<AdSlotStatus, string> = {
  queued: "border text-muted-foreground bg-transparent",
  rendering: "border-brand/50 text-brand bg-transparent",
  done: "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400",
  failed:
    "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400",
};

// ----------------------------------------------------------------- gallery

/** One rendered ad, or the state it is currently in. Queued/rendering shows a
 *  square skeleton (the ads are 1:1, so the placeholder must be too); failed
 *  shows the provider's own error plus the retry the backend supports. */
export function AdSlotCard({
  runId,
  slot,
  nonce,
  onRetry,
  busy,
}: {
  runId: string;
  slot: AdSlot;
  nonce: number;
  onRetry?: (slot: AdSlot) => void;
  busy?: boolean;
}) {
  return (
    <Card className="gap-0 overflow-hidden rounded-lg border bg-card py-0">
      <div className="relative aspect-square w-full bg-muted">
        {slot.status === "done" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={adSlotImageUrl(runId, slot.id, nonce)}
            alt={slot.headline || slot.direction_label}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : isSlotPending(slot) ? (
          <div className="flex h-full w-full items-center justify-center">
            <Skeleton className="h-full w-full rounded-none" />
            <span className="absolute text-xs text-muted-foreground">
              {slot.status === "rendering" ? "Rendering…" : "Queued"}
            </span>
          </div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
            <p className="text-xs font-medium text-destructive">Render failed</p>
            {slot.error ? (
              <p
                className="line-clamp-4 text-[11px] text-muted-foreground"
                title={slot.error}
              >
                {slot.error}
              </p>
            ) : null}
            {onRetry ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={busy}
                onClick={() => onRetry(slot)}
              >
                {busy ? "…" : "Retry"}
              </Button>
            ) : null}
          </div>
        )}
        <span className="absolute left-2 top-2">
          <Badge
            variant="outline"
            className={cn(
              "bg-background/85 font-mono text-[10px] backdrop-blur",
              SLOT_TONE[slot.status],
            )}
          >
            {slot.status}
          </Badge>
        </span>
      </div>
      <CardContent className="space-y-1.5 p-3">
        <p className="line-clamp-2 text-sm font-semibold leading-snug">
          {slot.headline || slot.direction_label}
        </p>
        {slot.subheadline ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">{slot.subheadline}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-1 pt-1">
          <Badge variant="secondary" className="text-[10px]">
            {slot.direction_label || slot.direction_key}
          </Badge>
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            {slot.subject_kind === "product"
              ? slot.product_name || "Product"
              : "Company"}
          </Badge>
        </div>
        <p
          className="truncate font-mono text-[10px] text-muted-foreground"
          title={slot.image_model_id}
        >
          {slot.image_model_name || slot.image_model_id}
        </p>
      </CardContent>
    </Card>
  );
}

/** The run's slots as a responsive 1:1 grid, in plan order. */
export function AdRunGallery({
  runId,
  slots,
  nonce,
  onRetry,
  busySlot,
}: {
  runId: string;
  slots: AdSlot[];
  nonce: number;
  onRetry?: (slot: AdSlot) => void;
  busySlot?: string | null;
}) {
  if (slots.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-card px-6 py-12 text-center">
        <p className="text-sm font-medium">Planning the run</p>
        <p className="mt-1 text-xs text-muted-foreground">
          The brand research and the creative plan land first; slots appear here
          the moment the plan is written.
        </p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {slots.map((s) => (
        <AdSlotCard
          key={s.id}
          runId={runId}
          slot={s}
          nonce={nonce}
          onRetry={onRetry}
          busy={busySlot === s.id}
        />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------- page

export function AdCreativesClient({
  initialRuns,
  niches,
}: {
  initialRuns: AdRun[];
  niches: Niche[];
}) {
  const { data: runs, mutate } = useSWR<AdRun[]>(adCreativeKeys.runs(), clientFetch, {
    fallbackData: initialRuns,
    refreshInterval: (latest) =>
      (latest ?? []).some(isRunActive) ? POLL_MS : 0,
  });
  const list = runs ?? [];
  const newest = list[0];

  const [domain, setDomain] = React.useState("");
  const [nicheId, setNicheId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [notConfigured, setNotConfigured] = React.useState(false);

  // The newest run's gallery is shown inline so the landing route has real
  // artwork on it, not just a list of ids.
  const { data: detail, mutate: mutateDetail } = useSWR<AdRunDetail>(
    newest ? adCreativeKeys.run(newest.id) : null,
    clientFetch,
    {
      refreshInterval: (latest) =>
        latest && (isRunActive(latest.run) || latest.slots.some(isSlotPending))
          ? POLL_MS
          : 0,
    },
  );
  const [nonce, setNonce] = React.useState(0);
  const [busySlot, setBusySlot] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = domain.trim();
    if (!value) {
      toast.error("Enter a public website domain, e.g. stripe.com");
      return;
    }
    setBusy(true);
    try {
      await createAdRun({ domain: value, niche_id: nicheId || null });
      toast.success("Run queued — researching the brand");
      setDomain("");
      await mutate();
    } catch (err) {
      if (isNotConfigured(err)) setNotConfigured(true);
      else toast.error(err instanceof Error ? err.message : "Could not start the run");
    } finally {
      setBusy(false);
    }
  }

  async function retry(slot: AdSlot) {
    if (!newest) return;
    setBusySlot(slot.id);
    try {
      await retryAdSlot(newest.id, slot.id);
      toast.success("Re-rendering that slot");
      setNonce((n) => n + 1);
      await mutateDetail();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setBusySlot(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ad studio</h1>
        <p className="text-sm text-muted-foreground">
          Give it a public domain. It researches the brand, writes a plan of
          distinct creative directions, and renders each one as a square ad on
          its own image model.
        </p>
      </div>

      {notConfigured ? (
        <Card>
          <CardContent className="space-y-2 py-8 text-center">
            <h3 className="text-base font-semibold">Ad studio isn&apos;t enabled here</h3>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              This deployment is missing the ad studio feature flag or its brand
              research key, so new runs can&apos;t be accepted. Anything already
              rendered stays below.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <label htmlFor="domain" className="text-sm font-medium">
                  Brand domain
                </label>
                <Input
                  id="domain"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="stripe.com"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={253}
                />
              </div>
              <div className="space-y-1.5 sm:w-60">
                <label htmlFor="niche" className="text-sm font-medium">
                  Bill to niche <span className="text-muted-foreground">(optional)</span>
                </label>
                <select
                  id="niche"
                  value={nicheId}
                  onChange={(e) => setNicheId(e.target.value)}
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm focus-visible:border-primary focus-visible:outline-none"
                >
                  <option value="">Account spend</option>
                  {niches.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.title}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={busy} className="sm:w-40">
                {busy ? "Queueing…" : "Generate ads"}
              </Button>
            </form>
            <p className="mt-3 text-xs text-muted-foreground">
              One run renders 4–6 square ads: three company concepts on the
              primary models, then one per product on the secondary models.
            </p>
          </CardContent>
        </Card>
      )}

      {newest ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">
                {newest.brand_name || newest.domain}
              </h2>
              <RunStatusBadge status={detail?.run.status ?? newest.status} />
            </div>
            <Link
              href={`/ad-creatives/${newest.id}`}
              className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Open run →
            </Link>
          </div>
          {(detail?.run.error ?? newest.error) ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {detail?.run.error ?? newest.error}
            </p>
          ) : null}
          <AdRunGallery
            runId={newest.id}
            slots={detail?.slots ?? []}
            nonce={nonce}
            onRetry={retry}
            busySlot={busySlot}
          />
        </section>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <h3 className="text-lg font-semibold">No runs yet</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Enter a domain above. The first gallery usually lands a couple of
              minutes later.
            </p>
          </CardContent>
        </Card>
      )}

      {list.length > 1 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Earlier runs</h2>
          <div className="flex flex-col rounded-lg border bg-card">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-10 text-xs font-medium text-muted-foreground">
                      Brand
                    </TableHead>
                    <TableHead className="h-10 text-xs font-medium text-muted-foreground">
                      Domain
                    </TableHead>
                    <TableHead className="h-10 text-xs font-medium text-muted-foreground">
                      Status
                    </TableHead>
                    <TableHead className="h-10 text-right text-xs font-medium text-muted-foreground">
                      Created
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.slice(1).map((r) => (
                    <TableRow key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                      <TableCell className="py-3 text-sm font-medium">
                        <Link
                          href={`/ad-creatives/${r.id}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {r.brand_name || "—"}
                        </Link>
                      </TableCell>
                      <TableCell className="py-3 font-mono text-xs text-muted-foreground">
                        {r.domain}
                      </TableCell>
                      <TableCell className="py-3">
                        <RunStatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-3 text-right text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
