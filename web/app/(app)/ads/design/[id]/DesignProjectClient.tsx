"use client";

// One design project: the plan, drawn as the DAG it actually is.
//
// Steps are grouped into the dependency layers the executor runs
// concurrently, each step showing its operation, what it consumes, its
// prompt, its status, and - once it has run - its output image. Per-step
// retry re-runs that step and everything downstream of it, which is exactly
// what you want when one panel of an otherwise good canvas is wrong.

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { clientFetch } from "@/lib/client-fetcher";
import { cn } from "@/lib/utils";
import {
  canRetryStep,
  designKeys,
  designStepImageUrl,
  formatAspectClass,
  hasStepOutput,
  isProjectActive,
  planLayers,
  planProgress,
  planSteps,
  retryDesignProject,
  retryDesignStep,
  type DesignProject,
  type DesignStep,
} from "@/lib/design-client";
import { ProjectStatusBadge, StepStatusBadge } from "../DesignClient";

const POLL_MS = 6_000;

function DependsOn({ ids }: { ids: string[] }) {
  if (ids.length === 0) {
    return (
      <span className="text-[11px] text-muted-foreground">no inputs - starts fresh</span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className="text-[11px] text-muted-foreground">consumes</span>
      {ids.map((d) => (
        <Badge key={d} variant="secondary" className="font-mono text-[10px]">
          {d}
        </Badge>
      ))}
    </span>
  );
}

function StepCard({
  project,
  step,
  nonce,
  onRetry,
  busy,
}: {
  project: DesignProject;
  step: DesignStep;
  nonce: number;
  onRetry: (step: DesignStep) => void;
  busy: boolean;
}) {
  const aspect = formatAspectClass(project.format);
  const retryable = canRetryStep(project);
  return (
    <Card
      className={cn(
        "gap-0 overflow-hidden rounded-lg border bg-card py-0",
        step.status === "failed" && "border-destructive/50",
      )}
    >
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
        <div className={cn("w-full shrink-0 overflow-hidden rounded-md bg-muted sm:w-40", aspect)}>
          {hasStepOutput(step) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={designStepImageUrl(project.id, step.id, nonce)}
              alt={step.label || step.id}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : step.status === "running" ? (
            <Skeleton className="h-full w-full rounded-none" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="font-mono text-[11px] text-muted-foreground">
                {step.status === "failed" ? "no output" : "not run yet"}
              </span>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full border font-mono text-[11px] tabular-nums text-muted-foreground">
              {step.index + 1}
            </span>
            <Badge variant="outline" className="font-mono text-[10px]">
              {step.operation}
            </Badge>
            <code className="font-mono text-[11px] text-muted-foreground">{step.id}</code>
            <StepStatusBadge status={step.status} />
            <Badge variant="secondary" className="text-[10px]">
              {step.inputs.quality}
            </Badge>
          </div>

          {step.label ? <p className="text-sm font-medium">{step.label}</p> : null}
          <DependsOn ids={step.depends_on} />

          {step.inputs.text ? (
            <p className="rounded-md border bg-muted/40 px-2 py-1 text-xs">
              <span className="text-muted-foreground">renders copy: </span>
              <span className="font-medium">“{step.inputs.text}”</span>
            </p>
          ) : null}

          {step.inputs.prompt ? (
            <details className="group">
              <summary className="cursor-pointer list-none text-[11px] text-muted-foreground underline-offset-4 hover:underline">
                prompt ▾
              </summary>
              <p className="mt-1 whitespace-pre-wrap rounded-md border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
                {step.inputs.prompt}
              </p>
            </details>
          ) : null}

          {step.error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
              {step.error}
            </p>
          ) : null}

          {retryable ? (
            <div className="pt-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={busy}
                onClick={() => onRetry(step)}
              >
                {busy ? "…" : "Re-run this step"}
              </Button>
              <span className="ml-2 text-[11px] text-muted-foreground">
                also re-runs everything downstream
              </span>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function DesignProjectClient({ initial }: { initial: DesignProject }) {
  const { data, mutate } = useSWR<DesignProject>(
    designKeys.project(initial.id),
    clientFetch,
    {
      fallbackData: initial,
      refreshInterval: (latest) => (latest && isProjectActive(latest) ? POLL_MS : 0),
    },
  );
  const project = data ?? initial;
  const steps = planSteps(project);
  const layers = React.useMemo(() => planLayers(steps), [steps]);
  const { done, total } = planProgress(project);
  const canvas = project.canvas ?? [];
  const notes = project.plan?.notes ?? [];

  const [nonce, setNonce] = React.useState(0);
  const [busyStep, setBusyStep] = React.useState<string | null>(null);
  const [busyProject, setBusyProject] = React.useState(false);

  async function retryStep(step: DesignStep) {
    setBusyStep(step.id);
    try {
      await retryDesignStep(project.id, step.id);
      toast.success(`Re-running from ${step.id}`);
      setNonce((n) => n + 1);
      await mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setBusyStep(null);
    }
  }

  async function retryProject() {
    setBusyProject(true);
    try {
      await retryDesignProject(project.id);
      toast.success("Resuming - completed steps keep their output");
      await mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setBusyProject(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href="/ads/design"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← Design agent
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {project.plan?.title || "Untitled design"}
          </h1>
          <ProjectStatusBadge status={project.status} />
          <Badge variant="outline" className="font-mono text-xs">
            {project.format}
          </Badge>
          {total > 0 ? (
            <span className="font-mono text-xs text-muted-foreground">
              {done}/{total} steps
            </span>
          ) : null}
          {project.status === "failed" ? (
            <Button size="sm" disabled={busyProject} onClick={retryProject}>
              {busyProject ? "…" : "Resume project"}
            </Button>
          ) : null}
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">{project.brief}</p>
      </div>

      {project.error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {project.error}
        </p>
      ) : null}

      {notes.length > 0 ? (
        <Card>
          <CardContent className="space-y-1.5 pt-6">
            <h2 className="text-sm font-semibold">Art direction</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">The plan</h2>
          <p className="text-sm text-muted-foreground">
            Grouped into the dependency layers the agent executes concurrently.
            A step only starts once every step it consumes has produced its
            image.
          </p>
        </div>

        {steps.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-card px-6 py-12 text-center">
            <p className="text-sm font-medium">
              {project.status === "failed" ? "No plan was produced" : "Writing the plan"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              The brief is turned into concrete steps and validated before a
              single image is bought - nothing has been spent yet.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {layers.map((layer, i) => (
              <div key={i} className="space-y-2">
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Layer {i + 1}
                  </span>
                  <Separator className="flex-1" />
                </div>
                <div className="space-y-2">
                  {layer.map((s) => (
                    <StepCard
                      key={s.id}
                      project={project}
                      step={s}
                      nonce={nonce}
                      onRetry={retryStep}
                      busy={busyStep === s.id}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {canvas.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Canvas</h2>
            <p className="text-sm text-muted-foreground">
              Every object the plan produced, content-addressed.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {canvas.map((obj) => (
              <Card
                key={`${obj.step_id}-${obj.digest}`}
                className="gap-0 overflow-hidden rounded-lg border bg-card py-0"
              >
                <div
                  className={cn(
                    "w-full overflow-hidden bg-muted",
                    formatAspectClass(project.format),
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={designStepImageUrl(project.id, obj.step_id, nonce)}
                    alt={obj.label || obj.step_id}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </div>
                <CardContent className="space-y-1 p-3">
                  <p className="line-clamp-1 text-xs font-medium" title={obj.label}>
                    {obj.label || obj.step_id}
                  </p>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span className="font-mono">{obj.operation}</span>
                    <span className="font-mono tabular-nums">
                      {obj.bytes > 0 ? `${Math.round(obj.bytes / 1024)} KB` : obj.size}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
