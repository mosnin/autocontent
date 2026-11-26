"use client";

import { BookOpenText, ChevronDown, Clapperboard, Plug } from "lucide-react";
import { useState } from "react";
import { Button, ButtonLink, Callout, Column, EmptyLine, PageHeader, Popover, Segmented, StatLine, ToolTitle } from "@/design-system";
import { TOOL_ICON } from "@/components/shell/sidebar";
import { StartSession } from "@/components/chat/start-session";
import { formatCompact, formatUsd } from "@/lib/format";
import type { ImagePost, Job, Niche, TodaySpend } from "@/lib/types";
import { CarouselsList } from "./carousels";
import { FailuresPanel } from "./failures";
import { MakeDialog, type MakeKind } from "./make-dialog";
import { LiveRefresh, toolGlyph, useUrlTab } from "./shared";
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

/**
 * The other video makers, as links behind one quiet "Create" button so the
 * header keeps one primary action and fits a phone: Story video (an idea or
 * script as a multi-shot film) and Short video (stock footage, in variants).
 */
function CreateMenu() {
  return (
    <Popover
      label="Create"
      align="right"
      className="w-[min(240px,calc(100vw-2rem))] p-1"
      trigger={({ toggle, ...aria }) => (
        <Button variant="secondary" onClick={toggle} aria-expanded={aria["aria-expanded"]} aria-haspopup={aria["aria-haspopup"]}>
          Create <ChevronDown />
        </Button>
      )}
    >
      {() => (
        <div className="flex flex-col">
          <ButtonLink href="/content/stories" variant="ghost" className="justify-start">
            <BookOpenText /> Story video
          </ButtonLink>
          <ButtonLink href="/content/short" variant="ghost" className="justify-start">
            <Clapperboard /> Short video
          </ButtonLink>
        </div>
      )}
    </Popover>
  );
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
          <>
          <CreateMenu />
          <Button variant="primary" onClick={() => setMake({ kind: tab === "carousels" ? "carousel" : "video" })}>
            Make something
          </Button>
          </>
        }
      />
      <Column
        width="lg"
        panelKey={tab}
        title={<ToolTitle icon={TOOL_ICON.content.icon} tone={TOOL_ICON.content.tone}>Content</ToolTitle>}
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

        {tab === "videos" ? (
          <div>
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
          </div>
        ) : tab === "carousels" ? (
          <div>
            <CarouselsList posts={imagePosts} niches={niches} onMake={() => setMake({ kind: "carousel" })} />
          </div>
        ) : (
          <div>
            <TemplatesGrid templates={data.templates} preview={preview} />
          </div>
        )}

        <FailuresPanel failures={data.failures} />
      </Column>
      <MakeDialog open={make !== null} onClose={() => setMake(null)} niches={niches} spend={spend} initial={make ?? undefined} />
    </>
  );
}
