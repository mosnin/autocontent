"use client";

import { Clapperboard, Plug } from "lucide-react";
import { useState } from "react";
import { departmentById } from "@/lib/departments";
import { formatCompact, formatUsd } from "@/lib/format";
import type { ImagePost, Job, Niche, TodaySpend } from "@/lib/types";
import { StartSession } from "../agent/start-session";
import { PageBody, PageHeader, PageIntro, Stat } from "../page";
import { Button, ButtonLink, Empty, IconTile } from "../ui";
import { Tabs, useLiveRefresh, useUrlTab } from "./bits";
import { CarouselsList } from "./carousels";
import { FailuresPanel } from "./failures";
import { MakeDialog, type MakeKind } from "./make-dialog";
import { JOB_IN_PROGRESS, POST_IN_PROGRESS, type VideoFilter } from "./status";
import { TemplatesGrid } from "./templates";
import type { Failures, MetricsSummary, Template } from "./types";
import { VideosList } from "./videos";

export type ContentTab = "videos" | "carousels" | "templates";

export interface ContentData {
  jobs: Job[] | null;
  niches: Niche[];
  imagePosts: ImagePost[] | null;
  templates: Template[] | null;
  spend: TodaySpend | null;
  failures: Failures | null;
  metrics: MetricsSummary | null;
  /** null = unknown (endpoint missing). */
  channelsConnected: boolean | null;
  globalCap: string | null;
}

export function ContentView({ data, tab: initialTab = "videos", filter, preview }: { data: ContentData; tab?: ContentTab; filter?: VideoFilter; preview?: boolean }) {
  const dept = departmentById("content")!;
  const [tab, setTab] = useUrlTab<ContentTab>(initialTab);
  const [make, setMake] = useState<{ kind: MakeKind } | null>(null);
  const { jobs, niches, imagePosts, spend } = data;

  const working = (jobs ?? []).some((j) => JOB_IN_PROGRESS.has(j.status)) || (imagePosts ?? []).some((p) => POST_IN_PROGRESS.has(p.status));
  useLiveRefresh(working && !preview);

  const waiting = (jobs ?? []).filter((j) => j.status === "awaiting_approval").length + (imagePosts ?? []).filter((p) => p.status === "awaiting_approval").length;
  const inProgress = (jobs ?? []).filter((j) => JOB_IN_PROGRESS.has(j.status)).length + (imagePosts ?? []).filter((p) => POST_IN_PROGRESS.has(p.status)).length;
  const spent = Number(spend?.total_usd ?? 0);
  const cap = data.globalCap != null ? Number(data.globalCap) : niches.reduce((a, n) => a + Number(n.daily_spend_cap_usd || 0), 0);

  return (
    <>
      <PageHeader icon={<Clapperboard />} title="Content">
        <Button variant="primary" size="sm" onClick={() => setMake({ kind: tab === "carousels" ? "carousel" : "video" })}>
          Make something
        </Button>
      </PageHeader>
      <PageBody width="5xl">
        <PageIntro title="Content">{dept.summary}</PageIntro>
        <div className="t-stagger space-y-8">
          <StartSession scope="content" lockScope suggestions={dept.asks} />

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Spent today" value={formatUsd(spent)} delta={cap > 0 ? <span className="text-[12px] text-muted-foreground tabular">of {formatUsd(cap, { cents: false })}</span> : undefined} />
            <Stat label="Needs approval" value={<span className={waiting ? "text-queued" : undefined}>{waiting}</span>} />
            <Stat label="In progress" value={inProgress} />
            <Stat
              label="Views · 30 days"
              value={data.metrics ? formatCompact(data.metrics.total_views) : "—"}
              delta={data.metrics && data.metrics.sampled_videos > 0 ? <span className="text-[12px] text-muted-foreground tabular">{formatCompact(Math.round(data.metrics.total_views / data.metrics.sampled_videos))}/video</span> : undefined}
            />
          </div>

          {data.channelsConnected === false && (
            <div className="flex flex-wrap items-center gap-3 rounded-[20px] border border-border bg-card px-4 py-3">
              <IconTile>
                <Plug />
              </IconTile>
              <div className="min-w-0 flex-1 basis-[220px]">
                <div className="text-[14px] font-medium">Channels aren't connected</div>
                <div className="text-[13px] text-muted-foreground">Videos still render, but nothing posts until TikTok, Reels or Shorts are linked.</div>
              </div>
              <ButtonLink href="/integrations" size="sm">
                Connect channels
              </ButtonLink>
            </div>
          )}

          <FailuresPanel failures={data.failures} />

          <section className="space-y-4">
            <Tabs
              value={tab}
              onChange={setTab}
              label="Content type"
              options={[
                { value: "videos", label: "Videos" },
                { value: "carousels", label: "Carousels" },
                { value: "templates", label: "Templates" },
              ]}
            />
            {tab === "videos" ? (
              jobs === null ? (
                <Empty art="activity" title="Couldn't load videos">The API didn't answer. Try again in a moment.</Empty>
              ) : niches.length === 0 && jobs.length === 0 ? (
                <Empty art="files" title="Start with a playbook" action={<ButtonLink href="/playbooks/new" variant="primary">Create a playbook</ButtonLink>}>
                  A playbook says who you're talking to, how to sound and where to post. Videos are made from it.
                </Empty>
              ) : (
                <VideosList jobs={jobs} niches={niches} initialFilter={filter} />
              )
            ) : tab === "carousels" ? (
              <CarouselsList posts={imagePosts} niches={niches} onMake={() => setMake({ kind: "carousel" })} />
            ) : (
              <TemplatesGrid templates={data.templates} preview={preview} />
            )}
          </section>
        </div>
      </PageBody>
      <MakeDialog open={make !== null} onClose={() => setMake(null)} niches={niches} spend={spend} initial={make ?? undefined} />
    </>
  );
}
