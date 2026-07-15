"use client";

// Live job detail. Polls via SWR while the pipeline is still working so an
// in-progress "Rendering" skeleton flips to the finished video (or a failure)
// on its own — no manual reload. Mirrors ArticleDetailClient's polling model.

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { Reveal } from "@/components/marketing/reveal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { clientFetch } from "@/lib/client-fetcher";
import type { estimateVideoCostUsd } from "@/lib/cost-estimator";
import { formatUsd } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badge";
import type { Job, JobStatus, PostMetrics } from "@/lib/types";
import { MetricsTab } from "./MetricsTab";
import { RetryButton } from "./RetryButton";

const POLL_MS = 5000;

// Statuses where the pipeline has stopped and nothing more will change on
// its own — polling can halt. Everything else is treated as "still working".
const TERMINAL: ReadonlySet<JobStatus> = new Set<JobStatus>([
  "done",
  "failed",
  "skipped",
  "awaiting_approval",
]);

// Mirror of the in-flight set in `@/lib/status-badge` — used to light up the
// header + video card while the pipeline is actively producing the video.
const IN_PROGRESS: ReadonlySet<JobStatus> = new Set<JobStatus>([
  "ideating",
  "scripting",
  "generating_images",
  "animating",
  "voicing",
  "editing",
  "captioning",
  "qa",
  "scheduling",
]);

// Recording-light pulse — reused verbatim from the design system for anything
// "live" / in-progress.
function RecordingDot() {
  return (
    <span aria-hidden className="relative flex size-2">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
      <span className="relative inline-flex size-2 rounded-full bg-brand" />
    </span>
  );
}

// `Script` is intentionally typed loosely — the manual mirror in
// `web/lib/types.ts` only declares a tiny subset; the rest is shaped
// like the Pydantic model and we trust the API.
type Script = NonNullable<Job["script"]> & {
  cta?: string | null;
  total_duration_sec?: number;
  scenes?: Scene[];
};
type Scene = {
  index: number;
  narration: string;
  visual_prompt: string;
  motion_prompt: string;
  duration_sec: number;
};

export function JobDetailClient({
  initial,
  nicheTitle,
  breakdown,
  jobMetrics,
}: {
  initial: Job;
  nicheTitle: string | null;
  breakdown: ReturnType<typeof estimateVideoCostUsd> | null;
  jobMetrics: { latest: PostMetrics | null; history: PostMetrics[] } | null;
}) {
  const { data, mutate } = useSWR<Job>(
    `/api/v1/jobs/${initial.id}`,
    clientFetch,
    {
      fallbackData: initial,
      // Poll while the pipeline is working; stop once terminal.
      refreshInterval: (latest) =>
        TERMINAL.has((latest ?? initial).status) ? 0 : POLL_MS,
    },
  );

  const job = data ?? initial;

  // The TS type for Job.script intentionally only declares `idea` —
  // the full Pydantic model carries more. Re-cast through `Script` for
  // the panels that need scenes/cta.
  const fullScript = job.script as Script | null | undefined;

  const ayrshareUrl = job.provider_post_id
    ? // TODO: confirm Ayrshare's hosted permalink shape; this is the
      // /posts/<id> path their dashboard uses today.
      `https://app.ayrshare.com/posts/${job.provider_post_id}`
    : null;

  const videoPath = job.rendered?.path
    ? `/api/proxy/api/v1/jobs/${job.id}/video`
    : null;

  const inProgress = IN_PROGRESS.has(job.status);

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/queue">
          <ArrowLeft className="h-4 w-4" />
          Back to queue
        </Link>
      </Button>

      <Reveal>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
              Job
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={job.status} />
              <code className="font-mono text-sm tabular-nums text-muted-foreground">
                {job.id}
              </code>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {nicheTitle ?? "Job"} ·{" "}
              <span className="capitalize text-muted-foreground">
                {job.platform}
              </span>
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {inProgress && (
                <span className="inline-flex items-center gap-1.5 font-medium text-brand">
                  <RecordingDot />
                  In progress — updates every {POLL_MS / 1000}s
                </span>
              )}
              <span className="tabular-nums">
                Created: {new Date(job.created_at).toLocaleString()}
              </span>
              {job.scheduled_for && (
                <span className="tabular-nums">
                  Scheduled: {new Date(job.scheduled_for).toLocaleString()}
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {job.status === "failed" && (
              <RetryButton
                jobId={job.id}
                onRetried={() => {
                  void mutate();
                }}
              />
            )}
            {ayrshareUrl && (
              <Button asChild variant="outline">
                <a href={ayrshareUrl} target="_blank" rel="noreferrer">
                  Open on Ayrshare
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            )}
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.05}>
        <div className="flex flex-col gap-6 lg:flex-row">
          <Card className="lg:w-1/2">
            <CardHeader>
              <CardTitle className="text-base">Rendered video</CardTitle>
            </CardHeader>
            <CardContent>
              {videoPath ? (
                <div className="mx-auto aspect-[9/16] w-full max-w-[360px] overflow-hidden rounded-lg border bg-black">
                  <video
                    controls
                    preload="metadata"
                    className="h-full w-full object-contain"
                    src={videoPath}
                  >
                    Your browser doesn&apos;t support the video tag.
                  </video>
                </div>
              ) : (
                <div className="rounded-lg border border-brand/20 bg-card/40 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <RecordingDot />
                    <span className="text-xs font-medium uppercase tracking-[0.2em] text-brand">
                      {job.status === "failed" ? "No render" : "Rendering"}
                    </span>
                  </div>
                  <Skeleton className="aspect-[9/16] w-full rounded-md" />
                  <p className="mt-3 text-xs text-muted-foreground">
                    {job.status === "failed"
                      ? "The pipeline failed before a video was produced."
                      : "The video appears here as soon as the pipeline finishes editing and captioning."}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="lg:w-1/2">
            <CardContent className="p-0">
              <Tabs defaultValue="script">
                <ScrollArea>
                  <TabsList className="w-max rounded-none rounded-t-lg border-b bg-transparent p-2 justify-start">
                    <TabsTrigger value="script">Script</TabsTrigger>
                    <TabsTrigger value="scenes">Scenes</TabsTrigger>
                    <TabsTrigger value="costs">Costs</TabsTrigger>
                    <TabsTrigger value="logs">Logs</TabsTrigger>
                    <TabsTrigger value="metrics">Metrics</TabsTrigger>
                  </TabsList>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>

                <TabsContent value="script" className="m-0 p-6">
                  {fullScript ? (
                    <ScriptPanel script={fullScript} />
                  ) : (
                    <Empty>No script yet</Empty>
                  )}
                </TabsContent>

                <TabsContent value="scenes" className="m-0 p-6">
                  {fullScript?.scenes && fullScript.scenes.length > 0 ? (
                    <ScenesPanel scenes={fullScript.scenes} />
                  ) : (
                    <Empty>No scenes yet</Empty>
                  )}
                </TabsContent>

                <TabsContent value="costs" className="m-0 p-6">
                  {breakdown ? (
                    <CostsPanel breakdown={breakdown} />
                  ) : (
                    <Empty>Niche data unavailable</Empty>
                  )}
                </TabsContent>

                <TabsContent value="logs" className="m-0 p-6">
                  {job.error ? (
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs text-destructive">
                      {job.error}
                    </pre>
                  ) : (
                    <Empty>No errors</Empty>
                  )}
                </TabsContent>

                <TabsContent value="metrics" className="m-0 p-6">
                  <MetricsTab
                    metrics={jobMetrics}
                    providerPostId={job.provider_post_id}
                  />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </Reveal>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function ScriptPanel({ script }: { script: Script }) {
  return (
    <div className="space-y-4 text-sm">
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Hook
        </h4>
        <p className="mt-1 italic">&ldquo;{script.idea.hook}&rdquo;</p>
      </section>
      <Separator />
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Topic
        </h4>
        <p className="mt-1">{script.idea.topic}</p>
      </section>
      {script.cta && (
        <>
          <Separator />
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              CTA
            </h4>
            <p className="mt-1">{script.cta}</p>
          </section>
        </>
      )}
    </div>
  );
}

function ScenesPanel({ scenes }: { scenes: Scene[] }) {
  return (
    <ol className="space-y-3 text-sm">
      {scenes.map((s) => (
        <li key={s.index} className="rounded-md border p-3">
          <div className="mb-1 flex items-baseline justify-between">
            <Badge variant="outline" className="font-mono">
              scene {s.index + 1}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {s.duration_sec.toFixed(1)}s
            </span>
          </div>
          <p className="text-sm">{s.narration}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            <span className="font-medium">Motion:</span> {s.motion_prompt}
          </p>
        </li>
      ))}
    </ol>
  );
}

function CostsPanel({
  breakdown,
}: {
  breakdown: ReturnType<typeof estimateVideoCostUsd>;
}) {
  const rows: [string, number][] = [
    ["Images", breakdown.image],
    ["Video (Grok Imagine)", breakdown.video],
    ["TTS", breakdown.tts],
    ["Whisper", breakdown.whisper],
    ["Character sheet", breakdown.character_sheet],
  ];
  return (
    <div className="space-y-4 text-sm">
      <Table>
        <TableBody>
          {rows.map(([label, n]) => (
            <TableRow key={label} className="border-0 hover:bg-transparent">
              <TableCell className="py-2 pl-0 text-muted-foreground">
                {label}
              </TableCell>
              <TableCell className="py-2 pr-0 text-right font-mono tabular-nums">
                {formatUsd(n)}
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="border-t border-border/60 hover:bg-transparent">
            <TableCell className="py-2 pl-0 font-medium">
              Total estimate
            </TableCell>
            <TableCell className="py-2 pr-0 text-right font-mono font-semibold tabular-nums">
              {formatUsd(breakdown.total)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        Estimated from the niche&apos;s current config — the actual run is
        billed from real provider invoices.
      </p>
    </div>
  );
}
