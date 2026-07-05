"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { Check, Inbox, Instagram, Music2, RefreshCw, Youtube } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  approveJobAction,
  rejectJobAction,
  retryJobAction,
} from "@/lib/actions";
import { clientFetch } from "@/lib/client-fetcher";
import { StatusBadge } from "@/lib/status-badge";
import type { Job, JobStatus } from "@/lib/types";

const POLL_MS = 5000;

const IN_PROGRESS = new Set<JobStatus>([
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

type Filter = "all" | "awaiting" | "in_progress" | "done" | "failed";

function matches(job: Job, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "awaiting") return job.status === "awaiting_approval";
  if (filter === "done") return job.status === "done";
  if (filter === "failed") return job.status === "failed";
  if (filter === "in_progress")
    return job.status === "queued" || IN_PROGRESS.has(job.status);
  return true;
}

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

export function QueueClient({ initial }: { initial: Job[] }) {
  const router = useRouter();
  const [filter, setFilter] = React.useState<Filter>("all");

  const { data, error, mutate } = useSWR<Job[]>(
    "/api/v1/jobs?limit=100",
    clientFetch,
    {
      refreshInterval: POLL_MS,
      fallbackData: initial,
    },
  );

  // Only toast the first error in a sequence, not every poll failure.
  const errorToastedRef = React.useRef(false);
  React.useEffect(() => {
    if (error && !errorToastedRef.current) {
      errorToastedRef.current = true;
      toast.error(`Live updates paused: ${error.message ?? "fetch failed"}`);
    }
    if (!error) {
      errorToastedRef.current = false;
    }
  }, [error]);

  const jobs = data ?? [];
  const inProgressCount = jobs.filter((j) => matches(j, "in_progress")).length;
  const awaitingCount = jobs.filter((j) => j.status === "awaiting_approval").length;

  const filtered = jobs.filter((j) => matches(j, filter));

  async function handleRetry(job: Job) {
    const prevJobs = jobs;

    // Optimistically move the job from "failed" to "queued".
    const optimisticJobs = jobs.map((j) =>
      j.id === job.id ? { ...j, status: "queued" as JobStatus } : j,
    );
    void mutate(optimisticJobs, false);

    const fd = new FormData();
    fd.set("job_id", job.id);
    const res = await retryJobAction({ ok: false }, fd);

    if (res.ok) {
      toast.success("Retry enqueued");
      // Revalidate to get the real server state.
      void mutate();
    } else {
      // Revert optimistic update.
      void mutate(prevJobs, false);
      toast.error(res.error ?? "Retry failed");
    }
  }

  async function handleApprove(job: Job) {
    const fd = new FormData();
    fd.set("job_id", job.id);
    const res = await approveJobAction({ ok: false }, fd);
    if (res.ok) {
      toast.success("Approved — scheduling the post now");
      void mutate();
    } else {
      toast.error(res.error ?? "Approve failed");
    }
  }

  async function handleReject(job: Job) {
    if (!confirm("Reject this video? It will never post.")) return;
    const fd = new FormData();
    fd.set("job_id", job.id);
    const res = await rejectJobAction({ ok: false }, fd);
    if (res.ok) {
      toast.success("Rejected — it will not post");
      void mutate();
    } else {
      toast.error(res.error ?? "Reject failed");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Queue</h1>
        <p className="text-sm text-muted-foreground">
          All pipeline runs. Updates every {POLL_MS / 1000}s.
        </p>
      </div>

      {error && (
        <p className="text-sm text-muted-foreground">
          Live updates paused — {error.message ?? "fetch failed"}
        </p>
      )}

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <ScrollArea>
          <TabsList className="w-max">
            <TabsTrigger value="all">
              All
              <TabCount value={jobs.length} />
            </TabsTrigger>
            {awaitingCount > 0 && (
              <TabsTrigger value="awaiting">
                Needs approval
                <TabCount live value={awaitingCount} />
              </TabsTrigger>
            )}
            <TabsTrigger value="in_progress">
              {inProgressCount > 0 && (
                <span aria-hidden className="relative mr-0.5 flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-brand" />
                </span>
              )}
              In progress
              <TabCount value={inProgressCount} live={inProgressCount > 0} />
            </TabsTrigger>
            <TabsTrigger value="done">
              Done
              <TabCount value={jobs.filter((j) => j.status === "done").length} />
            </TabsTrigger>
            <TabsTrigger value="failed">
              Failed
              <TabCount
                value={jobs.filter((j) => j.status === "failed").length}
              />
            </TabsTrigger>
          </TabsList>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        <TabsContent value={filter} className="mt-4">
          {filtered.length === 0 ? (
            <EmptyState filter={filter} />
          ) : (
            <div className="overflow-x-auto">
              <Card className="min-w-[640px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[140px]">Status</TableHead>
                      <TableHead className="w-[110px]">Job</TableHead>
                      <TableHead className="w-[110px]">Platform</TableHead>
                      <TableHead>Hook</TableHead>
                      <TableHead className="w-[120px]">Created</TableHead>
                      <TableHead className="w-[180px]">Scheduled</TableHead>
                      <TableHead className="w-[110px] text-right">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((j) => (
                      <JobRow
                        key={j.id}
                        job={j}
                        onClick={() => router.push(`/queue/${j.id}`)}
                        onRetry={handleRetry}
                        onApprove={handleApprove}
                        onReject={handleReject}
                      />
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyState({ filter }: { filter: Filter }) {
  const label =
    filter === "all"
      ? "No jobs yet"
      : `No ${filter.replace("_", " ")} jobs`;

  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="rounded-full bg-muted p-3">
          <Inbox className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">{label}</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          {filter === "all"
            ? "Trigger one from the dashboard or via the command palette (⌘K)."
            : "No jobs match this filter right now."}
        </p>
      </CardContent>
    </Card>
  );
}

function JobRow({
  job,
  onClick,
  onRetry,
  onApprove,
  onReject,
}: {
  job: Job;
  onClick: () => void;
  onRetry: (job: Job) => Promise<void>;
  onApprove: (job: Job) => Promise<void>;
  onReject: (job: Job) => Promise<void>;
}) {
  const [retrying, setRetrying] = React.useState(false);
  const [acting, setActing] = React.useState(false);

  async function handleApproveClick(e: React.MouseEvent) {
    e.stopPropagation();
    setActing(true);
    await onApprove(job);
    setActing(false);
  }

  async function handleRejectClick(e: React.MouseEvent) {
    e.stopPropagation();
    setActing(true);
    await onReject(job);
    setActing(false);
  }

  async function handleRetryClick(e: React.MouseEvent) {
    e.stopPropagation();
    setRetrying(true);
    await onRetry(job);
    setRetrying(false);
  }

  return (
    <TableRow
      onClick={onClick}
      className="group cursor-pointer transition-colors hover:bg-muted/40"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={`Job ${job.id.slice(0, 8)}, status ${job.status}`}
    >
      <TableCell>
        <StatusBadge status={job.status} />
      </TableCell>
      <TableCell>
        <code className="font-mono text-xs tabular-nums text-muted-foreground transition-colors group-hover:text-foreground">
          {job.id.slice(0, 8)}
        </code>
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-1.5 text-sm">
          <PlatformIcon platform={job.platform} />
          {PLATFORM_LABEL[job.platform] ?? job.platform}
        </span>
      </TableCell>
      <TableCell className="max-w-[420px] truncate">
        {job.script?.idea?.hook ? (
          <span className="italic text-muted-foreground">
            &ldquo;{job.script.idea.hook}&rdquo;
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="tabular-nums text-muted-foreground">
        {relative(job.created_at)}
      </TableCell>
      <TableCell className="tabular-nums text-muted-foreground">
        {job.scheduled_for
          ? new Date(job.scheduled_for).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "—"}
      </TableCell>
      <TableCell className="text-right">
        {job.status === "failed" && (
          <Button
            size="sm"
            variant="destructive"
            onClick={handleRetryClick}
            disabled={retrying}
            aria-label={`Retry job ${job.id.slice(0, 8)}`}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`} aria-hidden="true" />
            {retrying ? "…" : "Retry"}
          </Button>
        )}
        {job.status === "awaiting_approval" && (
          <span className="flex items-center justify-end gap-1.5">
            <Button
              aria-label={`Reject job ${job.id.slice(0, 8)}`}
              disabled={acting}
              onClick={handleRejectClick}
              size="sm"
              variant="ghost"
            >
              Reject
            </Button>
            <Button
              aria-label={`Approve and post job ${job.id.slice(0, 8)}`}
              disabled={acting}
              onClick={handleApproveClick}
              size="sm"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              {acting ? "…" : "Approve"}
            </Button>
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}


const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  reels: "Reels",
  shorts: "Shorts",
};

function PlatformIcon({ platform }: { platform: string }) {
  const cls = "size-3.5 text-muted-foreground";
  if (platform === "tiktok") return <Music2 className={cls} />;
  if (platform === "reels") return <Instagram className={cls} />;
  if (platform === "shorts") return <Youtube className={cls} />;
  return null;
}

function TabCount({ value, live }: { value: number; live?: boolean }) {
  return (
    <span
      className={
        live
          ? "ml-1.5 rounded-full bg-brand/15 px-1.5 text-[11px] font-medium tabular-nums text-brand"
          : "ml-1.5 rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground"
      }
    >
      {value}
    </span>
  );
}
