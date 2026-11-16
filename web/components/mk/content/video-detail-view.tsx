"use client";

import { Clapperboard, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { CostBreakdown } from "@/lib/cost-estimator";
import { formatCompact, formatUsd } from "@/lib/format";
import type { Job, JobStatus, Niche } from "@/lib/types";
import { StartSession } from "../agent/start-session";
import { Crumbs, PageBody, PageHeader, PageIntro, Panel, Stat } from "../page";
import { Badge, CheckCircle, Dot, Empty } from "../ui";
import { LineSpark, Meta, StatusWord, StepList, Time, useLiveRefresh } from "./bits";
import { jobDot, jobStatusLabel, jobTitle, jobTone, JOB_IN_PROGRESS, platformLabel, VIDEO_STEPS } from "./status";
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

/** The pipeline checklist; collapsed to one line once every step is done. */
export function PipelinePanel({ steps, current, complete, failed, live }: { steps: { id: string; label: string; detail?: string }[]; current: number; complete: boolean; failed: boolean; live: boolean }) {
  const [open, setOpen] = useState(!complete);
  return (
    <Panel
      label="Pipeline"
      action={
        live ? (
          <span className="text-[12px] text-muted-foreground">Updates live</span>
        ) : complete ? (
          <button type="button" onClick={() => setOpen((v) => !v)} className="text-[12px] text-muted-foreground hover:text-foreground" aria-expanded={open}>
            {open ? "Hide steps" : "Show steps"}
          </button>
        ) : undefined
      }
    >
      {open ? (
        <StepList steps={steps} current={current} complete={complete} failed={failed} />
      ) : (
        <div className="flex items-center gap-3">
          <CheckCircle />
          <span className="text-[14px]">
            All {steps.length} steps done<span className="text-muted-foreground">, from idea to {steps[steps.length - 1].label.toLowerCase()}</span>
          </span>
        </div>
      )}
    </Panel>
  );
}

function Player({ job }: { job: Job }) {
  const [broken, setBroken] = useState(false);
  const working = JOB_IN_PROGRESS.has(job.status);
  if (job.rendered?.path && !broken) {
    return (
      <div className="mx-auto aspect-[9/16] w-full max-w-[360px] overflow-hidden rounded-[20px] bg-black">
        <video controls preload="metadata" playsInline className="size-full object-contain" src={`/api/proxy/api/v1/jobs/${job.id}/video`} onError={() => setBroken(true)} />
      </div>
    );
  }
  return (
    <div className="mx-auto flex aspect-[9/16] w-full max-w-[360px] flex-col items-center justify-center gap-2 rounded-[20px] border border-border bg-subtle px-8 text-center">
      {working ? <Dot tone="live" /> : <Clapperboard className="size-6 stroke-[1.4] text-faint" />}
      <p className={working ? "t-shimmer text-[14px] font-medium" : "text-[14px] font-medium"}>{working ? "Rendering" : job.status === "failed" ? "No render" : broken ? "Video unavailable" : "Not rendered yet"}</p>
      <p className="text-[13px] text-muted-foreground">
        {working ? "The video shows up here as soon as editing and captions finish." : job.status === "failed" ? "The pipeline stopped before a video was made." : "The file may have been cleaned up."}
      </p>
    </div>
  );
}

export function VideoDetailView({ job, niche, metrics, costUsd, estimate, preview }: { job: Job; niche: Niche | null; metrics: JobMetrics | null; costUsd: string | null; estimate: CostBreakdown | null; preview?: boolean }) {
  useLiveRefresh(JOB_IN_PROGRESS.has(job.status) && !preview, 5000);
  const script = job.script as FullScript | null | undefined;
  const title = jobTitle(job);
  const { steps, current, complete, failed } = stepsFor(job, niche);
  const latest = metrics?.latest ?? null;
  const series = [...(metrics?.history ?? [])].sort((a, b) => a.sampled_at.localeCompare(b.sampled_at)).map((m) => ({ label: m.sampled_at.slice(5, 10), value: m.views ?? 0 }));
  const postUrl = job.provider_post_id ? `https://app.ayrshare.com/posts/${job.provider_post_id}` : null;

  const asks = [
    job.status === "failed" ? "Why did this video fail, and can you fix it?" : "How is this video doing compared to the rest?",
    `Make three new hooks in the style of “${title.slice(0, 60)}”`,
    "Turn this video into a carousel",
  ];

  return (
    <>
      <PageHeader icon={<Clapperboard />} title={<Crumbs items={[<Link key="c" href="/content" className="hover:text-foreground">Content</Link>, title]} />}>
        <VideoActions job={job} />
      </PageHeader>
      <PageBody width="5xl">
        <PageIntro
          title={title}
          action={
            postUrl ? (
              <a href={postUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
                Open post <ExternalLink className="size-3.5" />
              </a>
            ) : undefined
          }
        >
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusWord label={jobStatusLabel(job.status)} tone={jobTone(job.status)} dot={jobDot(job.status)} />
            <span>
              {niche ? (
                <Link href={`/playbooks/${niche.id}`} className="hover:text-foreground">
                  {niche.title}
                </Link>
              ) : (
                "Playbook"
              )}
              {" · "}
              {platformLabel(job.platform)}
              {" · "}
              <Time iso={job.created_at} />
            </span>
          </span>
        </PageIntro>

        <div className="t-stagger grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            <Player job={job} />
            <Panel label="Cost">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-muted-foreground">{costUsd != null ? "Actual" : "Estimated"}</span>
                <span className="text-[22px] font-medium tracking-[-0.02em] tabular">{formatUsd(costUsd ?? estimate?.total ?? 0)}</span>
              </div>
              {estimate && (
                <dl className="mt-3 space-y-1 border-t border-border pt-3 text-[13px] text-muted-foreground tabular">
                  {(
                    [
                      ["Keyframes", estimate.image],
                      ["Animation", estimate.video],
                      ["Voiceover", estimate.tts],
                      ["Captions", estimate.whisper],
                      ["Character sheet", estimate.character_sheet],
                    ] as const
                  ).map(([l, v]) => (
                    <div key={l} className="flex justify-between gap-3">
                      <dt>{l}</dt>
                      <dd>{formatUsd(v)}</dd>
                    </div>
                  ))}
                  <p className="pt-1 text-[12px] text-faint">{costUsd != null ? `Estimate was ${formatUsd(estimate.total)} from the playbook's settings.` : "From the playbook's current settings; billed from real provider costs."}</p>
                </dl>
              )}
            </Panel>
            <Panel label="Details">
              <Meta
                items={[
                  { label: "Video", value: <span className="font-mono text-[12px]">{job.id.slice(0, 8)}</span> },
                  { label: "Created", value: <Time iso={job.created_at} mode="datetime" /> },
                  ...(job.scheduled_for ? [{ label: "Posts", value: <Time iso={job.scheduled_for} mode="datetime" /> }] : []),
                  ...(job.rendered ? [{ label: "Length", value: <span className="tabular">{job.rendered.duration_sec.toFixed(0)}s</span> }] : []),
                ]}
              />
            </Panel>
          </div>

          <div className="min-w-0 space-y-4">
            {job.status === "failed" && job.error && (
              <div role="alert" className="rounded-[14px] border border-destructive/25 bg-destructive/[0.06] px-4 py-3">
                <div className="text-[13px] font-medium text-destructive">Why it failed</div>
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-foreground/80 [overflow-wrap:anywhere]">{job.error}</p>
              </div>
            )}

            <PipelinePanel steps={steps} current={current} complete={complete} failed={failed} live={JOB_IN_PROGRESS.has(job.status)} />

            <Panel label="Script">
              {script ? (
                <div className="space-y-4">
                  <div>
                    <div className="text-[13px] text-muted-foreground">Hook</div>
                    <p className="mt-0.5 text-[16px] font-medium leading-snug">“{script.idea.hook}”</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <div className="text-[13px] text-muted-foreground">Topic</div>
                      <p className="mt-0.5 text-[14px]">{script.idea.topic}</p>
                    </div>
                    {script.cta && (
                      <div>
                        <div className="text-[13px] text-muted-foreground">Call to action</div>
                        <p className="mt-0.5 text-[14px]">{script.cta}</p>
                      </div>
                    )}
                  </div>
                  {script.scenes && script.scenes.length > 0 && (
                    <ol className="divide-y divide-border border-t border-border">
                      {script.scenes.map((s) => (
                        <li key={s.index} className="flex gap-3 py-2.5">
                          <span className="w-5 shrink-0 pt-0.5 text-[12px] text-faint tabular">{s.index + 1}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px]">{s.narration}</p>
                            {s.motion_prompt && <p className="mt-0.5 text-[12px] text-muted-foreground">Motion: {s.motion_prompt}</p>}
                          </div>
                          <span className="shrink-0 text-[12px] text-faint tabular">{s.duration_sec.toFixed(1)}s</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ) : (
                <p className="text-[13px] text-muted-foreground">The script appears once the Content producer has written it.</p>
              )}
            </Panel>

            <Panel label="Performance" action={latest ? <span className="text-[12px] text-faint">Sampled <Time iso={latest.sampled_at} /></span> : undefined}>
              {latest ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat label="Views" value={formatCompact(latest.views)} />
                    <Stat label="Avg watch" value={secs(latest.avg_watch_time_sec)} />
                    <Stat label="Completion" value={pct(latest.completion_rate)} />
                    <Stat label="Likes" value={formatCompact(latest.likes)} />
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted-foreground tabular">
                    {latest.comments != null && <span>{formatCompact(latest.comments)} comments</span>}
                    {latest.shares != null && <span>{formatCompact(latest.shares)} shares</span>}
                    {latest.saves != null && <span>{formatCompact(latest.saves)} saves</span>}
                    {latest.reach != null && <span>{formatCompact(latest.reach)} reach</span>}
                    {latest.impressions != null && <span>{formatCompact(latest.impressions)} impressions</span>}
                    {latest.watch_time_sec != null && <span>{secs(latest.watch_time_sec)} watched</span>}
                  </div>
                  {series.length > 1 && (
                    <div>
                      <div className="mb-1 text-[13px] text-muted-foreground">Views over time</div>
                      <LineSpark points={series} format={(n) => formatCompact(n)} />
                    </div>
                  )}
                </div>
              ) : (
                <Empty art="activity" title="No numbers yet">
                  {job.provider_post_id ? "Analytics sync daily at 11:00 UTC; the first snapshot lands about a day after posting." : "Numbers start once the video posts."}
                </Empty>
              )}
            </Panel>

            <section>
              <div className="mb-2.5 flex items-center gap-2">
                <h2 className="text-[13px] text-muted-foreground">Ask the Content producer about this video</h2>
                {job.status === "failed" && <Badge tone="danger">Failed</Badge>}
              </div>
              <StartSession scope="content" lockScope suggestions={asks} />
            </section>
          </div>
        </div>
      </PageBody>
    </>
  );
}

