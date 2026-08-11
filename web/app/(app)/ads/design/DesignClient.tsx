"use client";

// Design Agent: a brief in, a validated PLAN out, executed step by step.
//
// The plan is the interesting artifact, so the list shows plan progress
// (steps done / steps planned) rather than a bare status pill, and the detail
// route renders the whole DAG. Composing is deliberately explicit about the
// step cap: every step is a paid image call.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { clientFetch } from "@/lib/client-fetcher";
import { cn } from "@/lib/utils";
import type { Niche } from "@/lib/types";
import {
  createDesignProject,
  DESIGN_MAX_STEPS,
  designKeys,
  isNotConfigured,
  isProjectActive,
  planProgress,
  type DesignFormat,
  type DesignProject,
  type DesignProjectStatus,
  type DesignStepStatus,
} from "@/lib/design-client";

const POLL_MS = 8_000;

const FORMATS: { value: DesignFormat; label: string }[] = [
  { value: "1:1", label: "1:1 square" },
  { value: "9:16", label: "9:16 vertical" },
  { value: "16:9", label: "16:9 wide" },
];

// ------------------------------------------------------------------ badges

const PROJECT_TONE: Record<DesignProjectStatus, string> = {
  queued: "border text-muted-foreground bg-transparent",
  planning: "border-brand/50 text-brand bg-transparent",
  executing: "border-brand/50 text-brand bg-transparent",
  done: "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400",
  failed:
    "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400",
};

export function ProjectStatusBadge({ status }: { status: DesignProjectStatus }) {
  const live = status === "planning" || status === "executing";
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 font-mono text-xs", PROJECT_TONE[status])}
    >
      {live && <span aria-hidden className="size-2 animate-pulse rounded-full bg-brand" />}
      {status}
    </Badge>
  );
}

const STEP_TONE: Record<DesignStepStatus, string> = {
  pending: "border text-muted-foreground bg-transparent",
  running: "border-brand/50 text-brand bg-transparent",
  done: "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400",
  failed:
    "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400",
  skipped: "border text-muted-foreground bg-transparent",
};

export function StepStatusBadge({ status }: { status: DesignStepStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 font-mono text-[10px]", STEP_TONE[status])}
    >
      {status === "running" && (
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-brand" />
      )}
      {status}
    </Badge>
  );
}

// -------------------------------------------------------------------- page

export function DesignClient({
  initialProjects,
  niches,
}: {
  initialProjects: DesignProject[];
  niches: Niche[];
}) {
  const router = useRouter();
  const { data, mutate } = useSWR<DesignProject[]>(designKeys.projects(), clientFetch, {
    fallbackData: initialProjects,
    refreshInterval: (latest) => ((latest ?? []).some(isProjectActive) ? POLL_MS : 0),
  });
  const projects = data ?? [];

  const [nicheId, setNicheId] = React.useState(niches[0]?.id ?? "");
  const [brief, setBrief] = React.useState("");
  const [format, setFormat] = React.useState<DesignFormat>("1:1");
  const [maxSteps, setMaxSteps] = React.useState(8);
  const [busy, setBusy] = React.useState(false);
  const [notConfigured, setNotConfigured] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!nicheId) {
      toast.error("Pick a niche — the project's spend is attributed to it.");
      return;
    }
    if (!brief.trim()) {
      toast.error("Describe what you want designed.");
      return;
    }
    setBusy(true);
    try {
      const project = await createDesignProject({
        niche_id: nicheId,
        brief: brief.trim(),
        format,
        max_steps: maxSteps,
      });
      toast.success("Planning started");
      setBrief("");
      await mutate();
      router.push(`/ads/design/${project.id}`);
    } catch (err) {
      if (isNotConfigured(err)) setNotConfigured(true);
      else toast.error(err instanceof Error ? err.message : "Could not start the project");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Design agent</h1>
        <p className="text-sm text-muted-foreground">
          Describe the deliverable. The agent writes an explicit plan — a graph
          of generate / edit / compose / upscale / overlay steps — validates it,
          then executes it onto a canvas one layer at a time.
        </p>
      </div>

      {notConfigured ? (
        <Card>
          <CardContent className="space-y-2 py-8 text-center">
            <h3 className="text-base font-semibold">
              The design agent isn&apos;t configured here
            </h3>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              This deployment can&apos;t accept new design projects right now.
              Existing projects are still readable below.
            </p>
          </CardContent>
        </Card>
      ) : niches.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 py-8 text-center">
            <h3 className="text-base font-semibold">Create a niche first</h3>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              A design project bills against a niche&apos;s spend cap, so it
              needs one to attribute to.
            </p>
            <Link
              href="/niches"
              className="inline-block text-sm font-medium underline underline-offset-4"
            >
              Go to niches
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="brief">Brief</Label>
                <Textarea
                  id="brief"
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  maxLength={4000}
                  rows={4}
                  placeholder="A launch announcement for our new espresso subscription: a hero shot of the box on a warm kitchen counter, a close crop of the beans, and a final composite with the headline over it."
                />
                <p className="text-xs text-muted-foreground">
                  {brief.length}/4000
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="niche">Niche</Label>
                  <select
                    id="niche"
                    value={nicheId}
                    onChange={(e) => setNicheId(e.target.value)}
                    className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm focus-visible:border-primary focus-visible:outline-none"
                  >
                    {niches.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="format">Format</Label>
                  <select
                    id="format"
                    value={format}
                    onChange={(e) => setFormat(e.target.value as DesignFormat)}
                    className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm focus-visible:border-primary focus-visible:outline-none"
                  >
                    {FORMATS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="max-steps">Max steps</Label>
                  <Input
                    id="max-steps"
                    type="number"
                    min={1}
                    max={DESIGN_MAX_STEPS}
                    value={maxSteps}
                    onChange={(e) =>
                      setMaxSteps(
                        Math.min(
                          DESIGN_MAX_STEPS,
                          Math.max(1, Number(e.target.value) || 1),
                        ),
                      )
                    }
                    className="font-mono tabular-nums"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Every step is a paid image call, so the plan is capped at{" "}
                  {DESIGN_MAX_STEPS} steps and validated before anything renders.
                </p>
                <Button type="submit" disabled={busy}>
                  {busy ? "Planning…" : "Plan it"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <h3 className="text-lg font-semibold">No projects yet</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              The first thing you&apos;ll see after submitting a brief is the
              plan — before a single image is bought.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-10 text-xs font-medium text-muted-foreground">
                    Project
                  </TableHead>
                  <TableHead className="h-10 text-xs font-medium text-muted-foreground">
                    Format
                  </TableHead>
                  <TableHead className="h-10 text-xs font-medium text-muted-foreground">
                    Plan
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
                {projects.map((p) => {
                  const { done, total } = planProgress(p);
                  return (
                    <TableRow key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                      <TableCell className="max-w-[360px] py-3">
                        <Link
                          href={`/ads/design/${p.id}`}
                          className="block truncate text-sm font-medium underline-offset-4 hover:underline"
                          title={p.brief}
                        >
                          {p.plan?.title || p.brief || "Untitled"}
                        </Link>
                        {p.plan?.title ? (
                          <p className="truncate text-xs text-muted-foreground" title={p.brief}>
                            {p.brief}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="py-3 font-mono text-xs text-muted-foreground">
                        {p.format}
                      </TableCell>
                      <TableCell className="py-3">
                        {total === 0 ? (
                          <span className="text-xs text-muted-foreground">
                            not planned yet
                          </span>
                        ) : (
                          <span className="flex w-32 items-center gap-2">
                            <Progress value={(done / total) * 100} className="h-1.5" />
                            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                              {done}/{total}
                            </span>
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="py-3">
                        <ProjectStatusBadge status={p.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-3 text-right text-xs text-muted-foreground">
                        {new Date(p.created_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
