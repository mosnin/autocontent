"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { Inbox, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { retryJobAction } from "@/lib/actions";
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

type Filter = "all" | "in_progress" | "done" | "failed";

function matches(job: Job, filter: Filter): boolean {
  if (filter === "all") return true;
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

  const { data, error } = useSWR<Job[]>("/api/v1/jobs?limit=100", clientFetch, {
    refreshInterval: POLL_MS,
    fallbackData: initial,
  });

  const jobs = data ?? [];
  const filtered = jobs.filter((j) => matches(j, filter));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Queue</h1>
        <p className="text-sm text-muted-foreground">
          All pipeline runs. Updates every {POLL_MS / 1000}s.
        </p>
      </div>

      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6 text-sm text-destructive">
            Live updates paused: {error.message ?? "fetch failed"}
          </CardContent>
        </Card>
      )}

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList>
          <TabsTrigger value="all">
            All
            <span className="ml-1.5 text-xs text-muted-foreground">
              {jobs.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="in_progress">
            In progress
            <span className="ml-1.5 text-xs text-muted-foreground">
              {jobs.filter((j) => matches(j, "in_progress")).length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="done">
            Done
            <span className="ml-1.5 text-xs text-muted-foreground">
              {jobs.filter((j) => j.status === "done").length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="failed">
            Failed
            <span className="ml-1.5 text-xs text-muted-foreground">
              {jobs.filter((j) => j.status === "failed").length}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value={filter} className="mt-4">
          {filtered.length === 0 ? (
            <EmptyState filter={filter} />
          ) : (
            <Card>
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
                    />
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyState({ filter }: { filter: Filter }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="rounded-full bg-muted p-3">
          <Inbox className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">
          {filter === "all" ? "No jobs yet" : `No ${filter.replace("_", " ")} jobs`}
        </h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          Trigger one from the dashboard or via the command palette (⌘K).
        </p>
      </CardContent>
    </Card>
  );
}

function JobRow({ job, onClick }: { job: Job; onClick: () => void }) {
  const [retrying, setRetrying] = React.useState(false);

  async function onRetry(e: React.MouseEvent) {
    e.stopPropagation();
    setRetrying(true);
    const fd = new FormData();
    fd.set("job_id", job.id);
    const res = await retryJobAction({ ok: false }, fd);
    setRetrying(false);
    if (res.ok) toast.success("Retry enqueued");
    else toast.error(res.error ?? "Retry failed");
  }

  return (
    <TableRow onClick={onClick} className="cursor-pointer">
      <TableCell>
        <StatusBadge status={job.status} />
      </TableCell>
      <TableCell>
        <code className="font-mono text-xs text-muted-foreground">
          {job.id.slice(0, 8)}
        </code>
      </TableCell>
      <TableCell className="capitalize">{job.platform}</TableCell>
      <TableCell className="max-w-[420px] truncate">
        {job.script?.idea?.hook ? (
          <span className="italic text-muted-foreground">
            &ldquo;{job.script.idea.hook}&rdquo;
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {relative(job.created_at)}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {job.scheduled_for ? new Date(job.scheduled_for).toLocaleString() : "—"}
      </TableCell>
      <TableCell className="text-right">
        {job.status === "failed" ? (
          <Button
            size="sm"
            variant="destructive"
            onClick={onRetry}
            disabled={retrying}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {retrying ? "…" : "Retry"}
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
