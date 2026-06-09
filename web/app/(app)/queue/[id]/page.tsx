import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { estimateVideoCostUsd } from "@/lib/cost-estimator";
import { formatUsd } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badge";
import type { Job, Niche, PostMetrics } from "@/lib/types";
import { MetricsTab } from "./MetricsTab";
import { RetryButton } from "./RetryButton";

export const dynamic = "force-dynamic";

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

async function fetchJob(id: string): Promise<Job | null> {
  try {
    return await api<Job>(`/api/v1/jobs/${id}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("404")) return null;
    throw e;
  }
}

async function fetchNiche(id: string): Promise<Niche | null> {
  try {
    return await api<Niche>(`/api/v1/niches/${id}`);
  } catch {
    return null;
  }
}

async function fetchJobMetrics(
  jobId: string,
): Promise<{ latest: PostMetrics | null; history: PostMetrics[] } | null> {
  try {
    return await api<{ latest: PostMetrics | null; history: PostMetrics[] }>(
      `/api/v1/jobs/${jobId}/metrics`,
    );
  } catch (e) {
    // 404 = endpoint not deployed yet (parallel PR); render empty state.
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("404") || msg.startsWith("422")) return null;
    throw e;
  }
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const job = await fetchJob(id);
  if (!job) notFound();

  const [niche, jobMetrics] = await Promise.all([
    fetchNiche(job.niche_id),
    fetchJobMetrics(id),
  ]);

  // The TS type for Job.script intentionally only declares `idea` —
  // the full Pydantic model carries more. Re-cast through `Script` for
  // the panels that need scenes/cta.
  const fullScript = job.script as Script | null | undefined;

  const breakdown = niche
    ? estimateVideoCostUsd({
        scene_count: niche.scene_count,
        image_quality: niche.image_quality,
        video_resolution: niche.video_resolution,
        scene_max_duration_sec: niche.scene_max_duration_sec,
        target_duration_sec: niche.target_duration_sec,
      })
    : null;

  const ayrshareUrl = job.provider_post_id
    ? // TODO: confirm Ayrshare's hosted permalink shape; this is the
      // /posts/<id> path their dashboard uses today.
      `https://app.ayrshare.com/posts/${job.provider_post_id}`
    : null;

  const videoPath = job.rendered?.path
    ? `/api/proxy/api/v1/jobs/${job.id}/video`
    : null;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/queue">
          <ArrowLeft className="h-4 w-4" />
          Back to queue
        </Link>
      </Button>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <StatusBadge status={job.status} />
            <code className="font-mono text-sm text-muted-foreground">
              {job.id}
            </code>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {niche?.title ?? "Job"} ·{" "}
            <span className="capitalize text-muted-foreground">
              {job.platform}
            </span>
          </h1>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Created: {new Date(job.created_at).toLocaleString()}</span>
            {job.scheduled_for && (
              <span>
                Scheduled: {new Date(job.scheduled_for).toLocaleString()}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {job.status === "failed" && <RetryButton jobId={job.id} />}
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

      <div className="flex flex-col gap-6 lg:flex-row">
        <Card className="lg:w-1/2">
          <CardHeader>
            <CardTitle className="text-base">Rendered video</CardTitle>
          </CardHeader>
          <CardContent>
            {videoPath ? (
              <div className="aspect-video w-full max-w-full overflow-hidden rounded-lg border bg-black">
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
              <div className="space-y-3">
                <Skeleton className="aspect-[9/16] w-full rounded-lg" />
                <p className="text-center text-sm text-muted-foreground">
                  Render in progress…
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
    <div className="space-y-2 text-sm">
      {rows.map(([label, n]) => (
        <div key={label} className="flex items-baseline justify-between">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-mono tabular-nums">{formatUsd(n)}</span>
        </div>
      ))}
      <Separator />
      <div className="flex items-baseline justify-between font-semibold">
        <span>Total estimate</span>
        <span className="font-mono tabular-nums">{formatUsd(breakdown.total)}</span>
      </div>
      <p className="pt-2 text-xs text-muted-foreground">
        Estimated from the niche&apos;s current config — the actual run is
        billed from real provider invoices.
      </p>
    </div>
  );
}
