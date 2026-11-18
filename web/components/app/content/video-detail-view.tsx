"use client";

import { Clapperboard, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AskPill, Callout, Card, ChartCard, Column, EmptyLine, Facts, KpiCard, LineChart, PageHeader, Section, StatusBadge, Thumb, Button, StatLine, StepList, Time } from "@/design-system";
import type { CostBreakdown } from "@/lib/cost-estimator";
import { formatCompact, formatUsd } from "@/lib/format";
import type { Job, JobStatus, Niche } from "@/lib/types";
import { LiveRefresh, toolGlyph } from "./shared";
import { JOB_IN_PROGRESS, jobStatusLabel, jobTitle, jobTone, platformLabel, VIDEO_STEPS } from "./status";
import type { FullScript, JobMetrics } from "./types";
import { VideoActions } from "./videos";

const pct = (r: string | null) => (r == null || Number.isNaN(Number(r)) ? "—" : `${(Number(r) * 100).toFixed(0)}%`);
const secs = (s: string | null) => {
  if (s == null) return "—";
  const n = Number(s);
  if (Number.isNaN(n)) return "—";
  if (n >= 3600) return `${formatCompact(Math.round(n / 3600))}h`;
  return n >= 60 ? `${(n / 60).toFixed(1)}m` : `${n.toFixed(0)}s`;
};

function stepsFor(job: Job, niche: Niche | null) {
  const steps = VIDEO_STEPS.filter((s) => s.id !== "awaiting_approval" || niche?.approve_before_post !== false || job.status === "awaiting_approval");
  const idx = (id: JobStatus) => steps.findIndex((s) => s.id === id);
  if (job.status === "done") return { steps, current: steps.length - 1, complete: true, failed: false };
  if (job.status === "failed" || job.status === "skipped") {
    // The job row doesn't record where it stopped; infer from what exists.
    const current = job.rendered ? idx("qa") : job.script ? idx("generating_images") : idx("ideating");
    return { steps, current, complete: false, failed: true };
  }
  return { steps, current: Math.max(0, steps.findIndex((s) => s.id === job.status)), complete: false, failed: false };
}

/** The pipeline as plan steps; collapsed to one line once every step is done. */
function Pipeline({ steps, current, complete, failed }: { steps: { id: string; label: string; detail?: string }[]; current: number; complete: boolean; failed: boolean }) {
  const [open, setOpen] = useState(!complete);
  return (
    <Section
      title="Pipeline"
      action={
        complete ? (
          <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? "Hide steps" : "Show steps"}
          </Button>
        ) : undefined
      }
    >
      <Card className="px-3.5 py-3">{open ? <StepList steps={steps} current={current} complete={complete} failed={failed} /> : <p className="text-[13px] text-fg-muted">All {steps.length} steps done.</p>}</Card>
    </Section>
  );
}

function Player({ job }: { job: Job }) {
  const [broken, setBroken] = useState(false);
  const working = JOB_IN_PROGRESS.has(job.status);
  return (
    <Thumb ratio="9/16" className="w-full">
      {job.rendered?.path && !broken ? (
        <video controls preload="metadata" playsInline className="absolute inset-0 size-full object-contain" src={`/api/proxy/api/v1/jobs/${job.id}/video`} onError={() => setBroken(true)} />
      ) : (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
          <Clapperboard className="size-5 text-fg-faint" />
          <span className="text-[12.5px] text-fg-muted">{working ? "Rendering" : job.status === "failed" ? "No render" : broken ? "Video unavailable" : "Not rendered yet"}</span>
        </span>
      )}
    </Thumb>
  );
}

/** Video detail (Detail template): crumbs and actions, then facts, the video, its script and numbers. */
export function VideoDetailView({ job, niche, metrics, costUsd, estimate, preview }: { job: Job; niche: Niche | null; metrics: JobMetrics | null; costUsd: string | null; estimate: CostBreakdown | null; preview?: boolean }) {
  const script = job.script as FullScript | null | undefined;
  const title = jobTitle(job);
  const { steps, current, complete, failed } = stepsFor(job, niche);
  const latest = metrics?.latest ?? null;
  const history = [...(metrics?.history ?? [])].sort((a, b) => a.sampled_at.localeCompare(b.sampled_at));
  const postUrl = job.provider_post_id ? `https://app.ayrshare.com/posts/${job.provider_post_id}` : null;
  const ask = job.status === "failed" ? `Why did the video "${title.slice(0, 60)}" fail, and can you fix it?` : `How is the video "${title.slice(0, 60)}" doing compared to the rest?`;

  return (
    <>
      <LiveRefresh active={JOB_IN_PROGRESS.has(job.status) && !preview} ms={5000} />
      <PageHeader
        icon={toolGlyph("content")}
        crumbs={[{ label: "Content", href: "/content" }, { label: title }]}
        actions={
          <>
            {postUrl && (
              <a href={postUrl} target="_blank" rel="noreferrer" className="hidden items-center gap-1.5 px-1.5 text-[12.5px] text-fg-muted hover:text-fg sm:flex">
                Open post <ExternalLink className="size-3.5" />
              </a>
            )}
            <VideoActions job={job} />
          </>
        }
      />
      <Column
        width="md"
        title={title}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusBadge tone={jobTone(job.status)}>{jobStatusLabel(job.status)}</StatusBadge>
            <span>
              {platformLabel(job.platform)} · <Time iso={job.created_at} />
            </span>
          </span>
        }
      >
        {job.status === "failed" && job.error && (
          <Callout tone="negative" title="Why it failed">
            <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{job.error}</span>
          </Callout>
        )}

        <div className="grid gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
          <div className="mx-auto w-full max-w-[220px] sm:max-w-none">
            <Player job={job} />
          </div>
          <div className="min-w-0 space-y-3">
            <Facts
              items={[
                { label: "Playbook", value: niche ? <Link href={`/playbooks/${niche.id}`} className="text-ds-accent hover:underline">{niche.title}</Link> : "—" },
                { label: "Platform", value: platformLabel(job.platform) },
                { label: "Created", value: <Time iso={job.created_at} mode="datetime" /> },
                ...(job.scheduled_for ? [{ label: "Posts", value: <Time iso={job.scheduled_for} mode="datetime" /> }] : []),
                ...(job.rendered ? [{ label: "Length", value: `${job.rendered.duration_sec.toFixed(0)}s` }] : []),
                { label: costUsd != null ? "Cost" : "Estimated cost", value: formatUsd(costUsd ?? estimate?.total ?? 0) },
                { label: "Video", value: <span className="font-mono text-[12px]">{job.id.slice(0, 8)}</span> },
              ]}
            />
            {postUrl && (
              <a href={postUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[12.5px] text-ds-accent hover:underline sm:hidden">
                Open post <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
        </div>

        <Pipeline steps={steps} current={current} complete={complete} failed={failed} />

        <Section title="Script">
          {script ? (
            <Card>
              <div className="space-y-3 px-3.5 py-3">
                <div>
                  <div className="text-[12px] text-fg-muted">Hook</div>
                  <p className="mt-0.5 text-[14px] font-medium leading-snug">“{script.idea.hook}”</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-[12px] text-fg-muted">Topic</div>
                    <p className="mt-0.5 text-[13px]">{script.idea.topic}</p>
                  </div>
                  {script.cta && (
                    <div>
                      <div className="text-[12px] text-fg-muted">Call to action</div>
                      <p className="mt-0.5 text-[13px]">{script.cta}</p>
                    </div>
                  )}
                </div>
              </div>
              {script.scenes && script.scenes.length > 0 && (
                <ol className="divide-y divide-hairline border-t border-hairline">
                  {script.scenes.map((s) => (
                    <li key={s.index} className="flex gap-3 px-3.5 py-2.5">
                      <span className="w-4 shrink-0 pt-px text-[12px] text-fg-faint tabular">{s.index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px]">{s.narration}</p>
                        {s.motion_prompt && <p className="mt-0.5 text-[12px] text-fg-muted">Motion: {s.motion_prompt}</p>}
                      </div>
                      <span className="shrink-0 text-[12px] text-fg-faint tabular">{s.duration_sec.toFixed(1)}s</span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          ) : (
            <EmptyLine>The script appears once it&apos;s written.</EmptyLine>
          )}
        </Section>

        <Section title="Performance" action={latest ? <span className="text-[12px] text-fg-faint">Sampled <Time iso={latest.sampled_at} /></span> : undefined}>
          {latest ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <KpiCard label="Views" value={formatCompact(latest.views)} bars={history.map((h) => h.views ?? 0)} />
                <KpiCard label="Avg watch" value={secs(latest.avg_watch_time_sec)} />
                <KpiCard label="Completion" value={pct(latest.completion_rate)} />
                <KpiCard label="Likes" value={formatCompact(latest.likes)} />
              </div>
              <StatLine
                items={[
                  ...(latest.comments != null ? [{ label: "comments", value: formatCompact(latest.comments) }] : []),
                  ...(latest.shares != null ? [{ label: "shares", value: formatCompact(latest.shares) }] : []),
                  ...(latest.saves != null ? [{ label: "saves", value: formatCompact(latest.saves) }] : []),
                  ...(latest.reach != null ? [{ label: "reach", value: formatCompact(latest.reach) }] : []),
                  ...(latest.impressions != null ? [{ label: "impressions", value: formatCompact(latest.impressions) }] : []),
                  ...(latest.watch_time_sec != null ? [{ label: "watched", value: secs(latest.watch_time_sec) }] : []),
                ]}
              />
              {history.length > 1 && (
                <ChartCard label="Views over time" value={formatCompact(latest.views)}>
                  <LineChart series={[{ label: "Views", values: history.map((h) => h.views ?? 0), kind: "current" }]} xLabels={history.map((h) => h.sampled_at.slice(5, 10))} height={160} />
                </ChartCard>
              )}
            </div>
          ) : (
            <EmptyLine>{job.provider_post_id ? "The first numbers land about a day after posting." : "Numbers start once the video posts."}</EmptyLine>
          )}
        </Section>

        {estimate && (
          <Section title={costUsd != null ? `Cost · ${formatUsd(costUsd)}` : `Estimated cost · ${formatUsd(estimate.total)}`}>
            <Facts
              items={[
                { label: "Keyframes", value: formatUsd(estimate.image) },
                { label: "Animation", value: formatUsd(estimate.video) },
                { label: "Voiceover", value: formatUsd(estimate.tts) },
                { label: "Captions", value: formatUsd(estimate.whisper) },
                { label: "Character sheet", value: formatUsd(estimate.character_sheet) },
                { label: costUsd != null ? "Estimate was" : "Total", value: formatUsd(estimate.total) },
              ]}
            />
          </Section>
        )}

        <AskPill label="Ask about this video" href={`/sessions/new?dept=content&q=${encodeURIComponent(ask)}`} />
      </Column>
    </>
  );
}
