"use client";

// Live job detail. Polls via SWR while the pipeline is still working so an
// in-progress "Rendering" skeleton flips to the finished video (or a failure)
// on its own — no manual reload. Mirrors ArticleDetailClient's polling model.

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { approveJobAction, rejectJobAction } from "@/lib/actions";
import { toastActionError } from "@/lib/errors";
import { clientFetch } from "@/lib/client-fetcher";
import type { estimateVideoCostUsd } from "@/lib/cost-estimator";
import { formatUsd, formatUsdPrecise } from "@/lib/format";
import { platformLabel } from "@/lib/labels";
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
  "rejected",
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

// The production line, in order. The wait is the show: while a run is in
// flight the page names the exact step and how far along the machine is.
const STAGES: { key: JobStatus; label: string }[] = [
  { key: "ideating", label: "Finding the idea" },
  { key: "scripting", label: "Writing the script" },
  { key: "generating_images", label: "Rendering scene images" },
  { key: "animating", label: "Animating scenes" },
  { key: "voicing", label: "Recording the voiceover" },
  { key: "editing", label: "Editing the cut" },
  { key: "captioning", label: "Burning in captions" },
  { key: "qa", label: "Quality check" },
  { key: "scheduling", label: "Scheduling the post" },
];

function ProgressRail({ status }: { status: JobStatus }) {
  const idx = STAGES.findIndex((s) => s.key === status);
  const isQueued = status === "queued";
  if (idx === -1 && !isQueued) return null;

  const current = isQueued ? 0 : idx;
  const pct = isQueued ? 4 : ((current + 0.5) / STAGES.length) * 100;
  return (
    <div className="rounded-lg border border-brand/20 bg-card/40 p-4">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-sm font-medium">
          {isQueued ? "Waiting for a machine…" : STAGES[current].label}
        </p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {isQueued ? "Starting" : `Step ${current + 1} of ${STAGES.length}`}
        </p>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-border/60">
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <ol className="mt-3 hidden flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground sm:flex">
        {STAGES.map((s, i) => (
          <li
            key={s.key}
            className={
              i < current
                ? "line-through opacity-60"
                : i === current && !isQueued
                  ? "font-medium text-brand"
                  : undefined
            }
          >
            {s.label}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The Review Room bar: the approve/reject decision lives on the page where
 * the video actually plays — never only on a table row.
 */
function ReviewBar({
  jobId,
  onDecided,
}: {
  jobId: string;
  onDecided: () => void;
}) {
  const [pending, setPending] = React.useState<"approve" | "reject" | null>(null);
  const [confirmReject, setConfirmReject] = React.useState(false);
  // Approving without a posting profile fails late, inside scheduling —
  // warn here, where the decision is being made.
  const { data: connect } = useSWR<{ connected: boolean }>(
    "/api/v1/connect/ayrshare/status",
    clientFetch,
  );

  async function decide(kind: "approve" | "reject") {
    setPending(kind);
    const fd = new FormData();
    fd.set("job_id", jobId);
    const res =
      kind === "approve"
        ? await approveJobAction({ ok: false }, fd)
        : await rejectJobAction({ ok: false }, fd);
    setPending(null);
    setConfirmReject(false);
    if (res.ok) {
      toast.success(
        kind === "approve"
          ? "Approved — scheduling the post now"
          : "Rejected — it will not post",
      );
      onDecided();
    } else {
      toastActionError(res.error, "Something went wrong — try again");
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-brand/30 bg-brand/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium">This video is waiting for your review.</p>
        <p className="text-xs text-muted-foreground">
          Watch it below, then approve to schedule it for the channel&apos;s next
          posting window — or reject and nothing posts.
        </p>
        {connect && !connect.connected && (
          <p className="mt-1 text-xs font-medium text-brand">
            Your socials aren&apos;t connected yet — the post can&apos;t ship until
            you{" "}
            <Link className="underline underline-offset-2" href="/connect">
              connect them
            </Link>
            .
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          variant="ghost"
          disabled={pending !== null}
          onClick={() => setConfirmReject(true)}
        >
          Reject
        </Button>
        <Button disabled={pending !== null} onClick={() => decide("approve")}>
          {pending === "approve" ? "Approving…" : "Approve & schedule"}
        </Button>
      </div>

      <Dialog open={confirmReject} onOpenChange={setConfirmReject}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this video?</DialogTitle>
            <DialogDescription>
              It will never post. The decision is recorded as a rejection —
              not a failure — and the rendered clips stay in your library
              for remixing.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmReject(false)}>
              Keep reviewing
            </Button>
            <Button
              variant="destructive"
              disabled={pending !== null}
              onClick={() => decide("reject")}
            >
              {pending === "reject" ? "Rejecting…" : "Reject video"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Recording-light pulse — reused verbatim from the design system for anything
// "live" / in-progress.
function RecordingDot() {
  return (
    <span aria-hidden className="relative flex size-2">
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
      // Poll fast while producing; slow-poll awaiting_approval (a decision
      // made in another tab must still update this page); stop when the
      // run can never change again.
      refreshInterval: (latest) => {
        const s = (latest ?? initial).status;
        if (s === "awaiting_approval") return 30_000;
        return TERMINAL.has(s) ? 0 : POLL_MS;
      },
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

  // First-video celebration: fire once per browser, in the room where it
  // actually happens (this page), not on a homepage the user may not visit.
  const [celebrate, setCelebrate] = React.useState(false);
  React.useEffect(() => {
    if (
      (job.status === "awaiting_approval" || job.status === "done") &&
      typeof window !== "undefined" &&
      !window.localStorage.getItem("marketer_first_video_seen")
    ) {
      window.localStorage.setItem("marketer_first_video_seen", "1");
      setCelebrate(true);
    }
  }, [job.status]);

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/queue">
          Back to queue
        </Link>
      </Button>

      <Reveal>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
              Video
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={job.status} />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {nicheTitle ?? "Video"} ·{" "}
              <span className="text-muted-foreground">
                {platformLabel(job.platform)}
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
                </a>
              </Button>
            )}
          </div>
        </div>
      </Reveal>

      <Dialog open={celebrate} onOpenChange={setCelebrate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your machine shipped its first video</DialogTitle>
            <DialogDescription>
              Ideated, written, animated, voiced, and mixed — start to finish,
              no hands on the wheel. It&apos;s below, waiting for you.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setCelebrate(false)}>Watch it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {job.status === "awaiting_approval" && (
        <Reveal delay={0.03}>
          <ReviewBar jobId={job.id} onDecided={() => void mutate()} />
        </Reveal>
      )}

      {(inProgress || job.status === "queued") && (
        <Reveal delay={0.03}>
          <ProgressRail status={job.status} />
        </Reveal>
      )}

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
              ) : null}
              {videoPath ? (
                <div className="mt-3 text-center">
                  <Button asChild size="sm" variant="outline">
                    <a href={videoPath} download={`${nicheTitle ?? "video"}.mp4`}>
                      Download MP4
                    </a>
                  </Button>
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
                      ? "This run failed before a video was produced."
                      : "The video appears here as soon as editing and captioning finish."}
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
                    <TabsTrigger value="logs">Issues</TabsTrigger>
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
                    <CostsPanel breakdown={breakdown} jobId={job.id} terminal={TERMINAL.has(job.status)} />
                  ) : (
                    <Empty>Channel data unavailable</Empty>
                  )}
                </TabsContent>

                <TabsContent value="logs" className="m-0 p-6">
                  {job.error ? (
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs text-destructive">
                      {job.error}
                    </pre>
                  ) : (
                    <Empty>No issues — this run is clean</Empty>
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
  jobId,
  terminal,
}: {
  breakdown: ReturnType<typeof estimateVideoCostUsd>;
  jobId: string;
  terminal: boolean;
}) {
  // The receipt: what the run actually consumed once real calls were
  // metered — fetched once the run has stopped changing.
  const { data: receipt } = useSWR<{
    metered_usd: string;
    charged_usd: string | null;
    billing_enabled: boolean;
  }>(terminal ? `/api/v1/jobs/${jobId}/receipt` : null, clientFetch);

  const rows: [string, number][] = [
    ["Scene images", breakdown.image],
    ["Animation", breakdown.video],
    ["Voiceover", breakdown.tts],
    ["Captions", breakdown.whisper],
    ["Character sheet", breakdown.character_sheet],
  ];
  const metered = receipt ? Number(receipt.metered_usd) : null;
  const charged = receipt?.charged_usd != null ? Number(receipt.charged_usd) : null;
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
      {metered !== null && metered > 0 && (
        <Table>
          <TableBody>
            <TableRow className="border-t border-border/60 hover:bg-transparent">
              <TableCell className="py-2 pl-0 font-medium">
                Actual metered cost
              </TableCell>
              <TableCell className="py-2 pr-0 text-right font-mono font-semibold tabular-nums">
                {formatUsdPrecise(metered)}
              </TableCell>
            </TableRow>
            {charged !== null && (
              <TableRow className="border-0 hover:bg-transparent">
                <TableCell className="py-2 pl-0 font-medium">
                  Charged to your balance
                </TableCell>
                <TableCell className="py-2 pr-0 text-right font-mono font-semibold tabular-nums">
                  {formatUsdPrecise(charged)}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
      <p className="text-xs text-muted-foreground">
        {metered !== null && metered > 0
          ? "The estimate comes from the channel's config; the actual figures are summed from this run's metered provider calls."
          : metered !== null
            ? "This run recorded no metered spend."
            : "Estimated from the channel's current config — the actual cost appears here once the run finishes."}
      </p>
    </div>
  );
}
