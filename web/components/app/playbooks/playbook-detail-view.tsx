"use client";

import { Archive, Pencil } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AskPill, Button, ButtonLink, Column, ConfirmModal, EmptyLine, Facts, KpiCard, List, Notice, PageHeader, Section, Segmented, StatusBadge, Table, Thumb } from "@/design-system";
import { archivePlaybookAction } from "@/lib/actions-work";
import { formatCompact, formatUsd } from "@/lib/format";
import type { Job, Niche, NichePerformance, SpendHistory, TodaySpend } from "@/lib/types";
import { MakeDialog } from "../content/make-dialog";
import { LiveRefresh, toolGlyph } from "../content/shared";
import { JOB_IN_PROGRESS, platformLabel } from "../content/status";
import { VideoRow } from "../content/videos";
import { cadence } from "./format";
import { CapMeter, costPer1k } from "./playbooks-view";

type SortKey = "views" | "cost" | "cpp";
type PerfJob = NichePerformance["jobs"][number];

function CharacterSheet({ nicheId, preview }: { nicheId: string; preview?: boolean }) {
  const [state, setState] = useState<"loading" | "ok" | "gone">(preview ? "gone" : "loading");
  if (state === "gone") return null;
  return (
    <Section title="Character sheet">
      <Thumb ratio="9/16" className="w-full max-w-[200px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/proxy/api/v1/niches/${nicheId}/character-sheet`} alt="Character sheet for this playbook" className={state === "ok" ? "absolute inset-0 size-full object-cover" : "absolute inset-0 size-full object-cover opacity-0"} onLoad={() => setState("ok")} onError={() => setState("gone")} />
      </Thumb>
    </Section>
  );
}

function Performance({ perf }: { perf: NichePerformance }) {
  const [sort, setSort] = useState<SortKey>("views");
  const cpp = (j: PerfJob) => (j.views ? (Number(j.cost_usd) / j.views) * 1000 : null);
  const rows = useMemo(() => {
    const val = (j: PerfJob) => (sort === "views" ? j.views : sort === "cost" ? Number(j.cost_usd) : cpp(j));
    // Views and cost sort high to low; cost per 1k sorts cheapest first.
    const dir = sort === "cpp" ? 1 : -1;
    return [...perf.jobs].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * dir;
    });
  }, [perf.jobs, sort]);
  const hasViews = perf.jobs.some((j) => j.views != null);
  return (
    <Section
      title="Performance · 30 days"
      action={
        <Segmented
          size="sm"
          value={sort}
          onChange={setSort}
          label="Sort by"
          options={[
            { value: "views", label: "Views" },
            { value: "cost", label: "Cost" },
            { value: "cpp", label: "Per 1k" },
          ]}
        />
      }
    >
      <Table
        rows={rows}
        rowKey={(j) => j.job_id}
        rowHref={(j) => `/content/videos/${j.job_id}`}
        columns={[
          {
            key: "hook",
            label: "Hook",
            render: (j) => (
              <span className="block min-w-0 py-1.5">
                <span className="line-clamp-1">{j.hook ?? <span className="font-mono text-[12px] text-fg-muted">{j.job_id.slice(0, 8)}</span>}</span>
                <span className="text-[12px] text-fg-faint">
                  {platformLabel(j.platform)}
                  {j.status === "failed" && <span className="text-negative"> · failed</span>}
                </span>
              </span>
            ),
          },
          { key: "views", label: "Views", align: "right", width: "80px", render: (j) => formatCompact(j.views) },
          { key: "cost", label: "Cost", align: "right", width: "80px", hideOnPhone: true, render: (j) => <span className="text-fg-muted">{formatUsd(j.cost_usd)}</span> },
          {
            key: "cpp",
            label: "Per 1k",
            align: "right",
            width: "80px",
            render: (j) => {
              const c = cpp(j);
              return <span className="text-fg-muted">{c != null ? formatUsd(c) : "—"}</span>;
            },
          },
        ]}
      />
      {!hasViews && <p className="mt-2 text-[12px] text-fg-muted">Views land about a day after the first post.</p>}
    </Section>
  );
}

const JOBS_LIMIT = 20;

/** Playbook detail (Detail template): crumbs and actions, KPIs, how it runs, what it made. */
export function PlaybookDetailView({
  niche,
  performance,
  spendHistory,
  spend,
  jobs,
  preview,
}: {
  niche: Niche;
  performance: NichePerformance | null;
  spendHistory: SpendHistory | null;
  spend: TodaySpend | null;
  jobs: Job[] | null;
  preview?: boolean;
}) {
  const router = useRouter();
  const [make, setMake] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cap = Number(niche.daily_spend_cap_usd);
  const today = Number(spend?.by_niche[niche.id] ?? 0);
  const total30 = Number(spendHistory?.total_usd ?? performance?.summary.total_spend_usd ?? 0);
  const cutoff = Date.now() - 30 * 86400_000;
  const doneInWindow = (jobs ?? []).filter((j) => j.status === "done" && new Date(j.created_at).getTime() >= cutoff).length;
  const truncated = (jobs?.length ?? 0) >= JOBS_LIMIT;
  const s = performance?.summary;
  const hasViews = (performance?.jobs ?? []).some((j) => j.views != null);

  // Daily spend for the last 30 days (missing days are zero).
  const days = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const r of spendHistory?.rows ?? []) byDay.set(r.day, (byDay.get(r.day) ?? 0) + Number(r.cost_usd));
    return Array.from({ length: 30 }, (_, i) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - (29 - i));
      return byDay.get(d.toISOString().slice(0, 10)) ?? 0;
    });
  }, [spendHistory]);
  const viewBars = [...(performance?.jobs ?? [])].reverse().map((j) => j.views ?? 0);

  const archive = async () => {
    setArchiving(true);
    setError(null);
    const res = await archivePlaybookAction(niche.id);
    setArchiving(false);
    if (res.ok) router.push("/playbooks");
    else setError(res.error ?? "Couldn't archive it.");
  };

  return (
    <>
      <LiveRefresh active={(jobs ?? []).some((j) => JOB_IN_PROGRESS.has(j.status)) && !preview} />
      <PageHeader
        icon={toolGlyph("strategy")}
        crumbs={[{ label: "Playbooks", href: "/playbooks" }, { label: niche.title }]}
        actions={
          <>
            {!niche.archived_at && (
              <Button variant="ghost" onClick={() => setConfirm(true)} aria-label="Archive playbook">
                <Archive />
                <span className="hidden sm:inline">Archive</span>
              </Button>
            )}
            <ButtonLink href={`/playbooks/${niche.id}/edit`} aria-label="Edit playbook">
              <Pencil />
              <span className="hidden sm:inline">Edit</span>
            </ButtonLink>
            {!niche.archived_at && (
              <Button variant="primary" onClick={() => setMake(true)}>
                Make a video
              </Button>
            )}
          </>
        }
      />
      <Column
        width="md"
        title={niche.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {niche.archived_at && <StatusBadge>Archived</StatusBadge>}
            <span>{niche.description}</span>
          </span>
        }
      >
        {error && <Notice error={error} />}

        <div className="grid grid-cols-2 gap-3">
          <KpiCard label="Today" value={<span className={cap > 0 && today / cap >= 0.8 ? "text-attention" : undefined}>{formatUsd(today)}</span>} />
          <KpiCard label="Spend · 30 days" value={formatUsd(total30)} bars={days} />
          <KpiCard label="Per video" value={doneInWindow > 0 ? `${truncated ? "~" : ""}${formatUsd(total30 / doneInWindow)}` : "—"} />
          <KpiCard label="Views · 30 days" value={hasViews && s ? formatCompact(s.total_views) : "—"} bars={hasViews ? viewBars : undefined} />
        </div>

        <Section title="How it runs">
          <Facts
            items={[
              { label: "For", value: <span className="whitespace-normal">{niche.target_audience || "—"}</span> },
              { label: "Posts to", value: niche.platforms.length ? niche.platforms.map(platformLabel).join(", ") : "Nowhere yet" },
              { label: "Cadence", value: <span suppressHydrationWarning>{cadence(niche.posting_windows)}</span> },
              { label: "Daily cap", value: <span className="inline-block w-[140px] text-left"><CapMeter spent={today} cap={cap} /></span> },
              { label: "Approval", value: niche.approve_before_post ? "Reviews each video" : "Posts on its own" },
              { label: "Format", value: `${niche.target_duration_sec}s · ${niche.scene_count} scenes · ${niche.video_resolution}` },
              { label: "Voice", value: <span className="capitalize">{niche.voice_provider === "elevenlabs" ? "ElevenLabs" : niche.voice}</span> },
              ...(s && hasViews ? [{ label: "Per 1k views", value: costPer1k(s.total_spend_usd, s.total_views) }] : []),
              ...(niche.hashtags.length ? [{ label: "Hashtags", value: niche.hashtags.map((h) => `#${h}`).join(" ") }] : []),
            ]}
          />
        </Section>

        {performance && performance.jobs.length > 0 ? (
          <Performance perf={performance} />
        ) : (
          <Section title="Performance · 30 days">
            <EmptyLine>Make a video to start collecting performance.</EmptyLine>
          </Section>
        )}

        <Section
          title="Recent videos"
          action={
            <Link href="/content" className="text-[12.5px] text-fg-muted hover:text-fg">
              All content
            </Link>
          }
        >
          {jobs && jobs.length > 0 ? (
            <List>
              {jobs.map((j) => (
                <VideoRow key={j.id} job={j} />
              ))}
            </List>
          ) : (
            <EmptyLine
              action={
                !niche.archived_at ? (
                  <Button variant="primary" onClick={() => setMake(true)}>
                    Make the first one
                  </Button>
                ) : undefined
              }
            >
              No videos from this playbook yet.
            </EmptyLine>
          )}
        </Section>

        <CharacterSheet nicheId={niche.id} preview={preview} />

        <AskPill label="Ask about this playbook" href={`/sessions/new?dept=strategy&q=${encodeURIComponent(`What's working in the ${niche.title} playbook, and what should change?`)}`} />
      </Column>
      <ConfirmModal open={confirm} onClose={() => setConfirm(false)} title={`Archive “${niche.title}”?`} confirmLabel="Archive" danger busy={archiving} error={error} onConfirm={() => void archive()}>
        It stops making and posting new content.
      </ConfirmModal>
      <MakeDialog open={make} onClose={() => setMake(false)} niches={[niche]} spend={spend} initial={{ kind: "video", nicheId: niche.id, lockKind: true }} />
    </>
  );
}
