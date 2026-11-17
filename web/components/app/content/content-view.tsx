"use client";

import { Plug } from "lucide-react";
import { useState } from "react";
import { Button, ButtonLink, Callout, Column, EmptyLine, PageHeader, Section, Segmented } from "@/design-system";
import { StartSession } from "@/components/chat/start-session";
import { formatCompact, formatUsd } from "@/lib/format";
import type { ImagePost, Job, Niche, TodaySpend } from "@/lib/types";
import { CarouselsList } from "./carousels";
import { FailuresPanel } from "./failures";
import { MakeDialog, type MakeKind } from "./make-dialog";
import { LiveRefresh, StatLine, toolGlyph, ToolTitle, useUrlTab } from "./shared";
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

/** Content (Tool template): scoped composer, today's numbers, then videos, carousels or templates. */
export function ContentView({ data, tab: initialTab = "videos", filter, preview }: { data: ContentData; tab?: ContentTab; filter?: VideoFilter; preview?: boolean }) {
  const [tab, setTab] = useUrlTab<ContentTab>(initialTab);
  const [make, setMake] = useState<{ kind: MakeKind } | null>(null);
  const { jobs, niches, imagePosts, spend } = data;

  const working = (jobs ?? []).some((j) => JOB_IN_PROGRESS.has(j.status)) || (imagePosts ?? []).some((p) => POST_IN_PROGRESS.has(p.status));
  const waiting = (jobs ?? []).filter((j) => j.status === "awaiting_approval").length + (imagePosts ?? []).filter((p) => p.status === "awaiting_approval").length;
  const inProgress = (jobs ?? []).filter((j) => JOB_IN_PROGRESS.has(j.status)).length + (imagePosts ?? []).filter((p) => POST_IN_PROGRESS.has(p.status)).length;
  const spent = Number(spend?.total_usd ?? 0);
  const cap = data.globalCap != null ? Number(data.globalCap) : niches.reduce((a, n) => a + Number(n.daily_spend_cap_usd || 0), 0);
  const m = data.metrics;
  const empty = niches.length === 0 && (jobs ?? []).length === 0;

  return (
    <>
      <LiveRefresh active={working && !preview} />
      <PageHeader
        icon={toolGlyph("content")}
        title="Content"
        actions={
          <Button variant="primary" onClick={() => setMake({ kind: tab === "carousels" ? "carousel" : "video" })}>
            Make something
          </Button>
        }
      />
      <Column
        width="lg"
        title={<ToolTitle tool="content">Content</ToolTitle>}
        description="Short-form video and carousels, made from your playbooks."
        control={
          <Segmented
            value={tab}
            onChange={setTab}
            label="Content type"
            options={[
              { value: "videos", label: "Videos" },
              { value: "carousels", label: "Carousels" },
              { value: "templates", label: "Templates" },
            ]}
          />
        }
      >
        <div className="space-y-4">
          <StartSession scope="content" lockScope />
          {!empty && (
            <StatLine
              items={[
                { label: cap > 0 ? `of ${formatUsd(cap, { cents: false })} spent today` : "spent today", value: formatUsd(spent) },
                { label: "need approval", value: waiting, tone: waiting ? "attention" : undefined },
                { label: "in progress", value: inProgress },
                { label: "views in 30 days", value: m ? formatCompact(m.total_views) : "—" },
                ...(m && m.sampled_videos > 0 ? [{ label: "per video", value: formatCompact(Math.round(m.total_views / m.sampled_videos)) }] : []),
              ]}
            />
          )}
        </div>

        {data.channelsConnected === false && (
          <Callout
            tone="attention"
            icon={<Plug />}
            title="Channels aren't connected"
            action={
              <ButtonLink href="/integrations" size="sm">
                Connect
              </ButtonLink>
            }
          >
            Videos render, but nothing posts until TikTok, Reels or Shorts are linked.
          </Callout>
        )}

        <FailuresPanel failures={data.failures} />

        {tab === "videos" ? (
          <Section title="Videos">
            {jobs === null ? (
              <EmptyLine>Couldn&apos;t load videos. Try again in a moment.</EmptyLine>
            ) : empty ? (
              <EmptyLine
                action={
                  <ButtonLink href="/playbooks/new" variant="primary">
                    Create a playbook
                  </ButtonLink>
                }
              >
                Videos are made from a playbook. Start with one.
              </EmptyLine>
            ) : (
              <VideosList jobs={jobs} niches={niches} initialFilter={filter} />
            )}
          </Section>
        ) : tab === "carousels" ? (
          <Section title="Carousels">
            <CarouselsList posts={imagePosts} niches={niches} onMake={() => setMake({ kind: "carousel" })} />
          </Section>
        ) : (
          <Section title="Templates">
            <TemplatesGrid templates={data.templates} preview={preview} />
          </Section>
        )}
      </Column>
      <MakeDialog open={make !== null} onClose={() => setMake(null)} niches={niches} spend={spend} initial={make ?? undefined} />
    </>
  );
}
