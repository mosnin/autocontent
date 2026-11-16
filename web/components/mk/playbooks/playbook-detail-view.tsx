"use client";

import { Archive, Compass, Pencil } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { archivePlaybookAction } from "@/lib/actions-work";
import { formatCompact, formatUsd } from "@/lib/format";
import type { Job, Niche, NichePerformance, Platform, SpendHistory, TodaySpend } from "@/lib/types";
import { StartSession } from "../agent/start-session";
import { Crumbs, List, PageBody, PageHeader, PageIntro, Panel, Stat } from "../page";
import { Badge, Button, ButtonLink, cx, Empty } from "../ui";
import { Bars, Meta, Note, useLiveRefresh } from "../content/bits";
import { MakeDialog } from "../content/make-dialog";
import { JOB_IN_PROGRESS, platformLabel } from "../content/status";
import { VideoRow } from "../content/videos";
import { cadence } from "./format";
import { CapMeter, costPer1k } from "./playbooks-view";

type SortKey = "views" | "cost" | "cpp";

function CharacterSheet({ nicheId, preview }: { nicheId: string; preview?: boolean }) {
  const [state, setState] = useState<"loading" | "ok" | "gone">(preview ? "gone" : "loading");
  if (state === "gone") return null;
  return (
    <Panel label="Character sheet">
      <p className="-mt-1 mb-3 text-[13px] text-muted-foreground">Every scene is kept consistent with this.</p>
      <div className={cx("relative mx-auto aspect-[9/16] w-full max-w-[220px] overflow-hidden rounded-[14px] bg-muted", state === "loading" && "animate-pulse")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/proxy/api/v1/niches/${nicheId}/character-sheet`} alt="Character sheet for this playbook" className={cx("size-full object-cover transition-opacity duration-300", state === "ok" ? "opacity-100" : "opacity-0")} onLoad={() => setState("ok")} onError={() => setState("gone")} />
      </div>
    </Panel>
  );
}

function PerformanceTable({ perf }: { perf: NichePerformance }) {
  const router = useRouter();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "views", dir: -1 });
  const cpp = (j: NichePerformance["jobs"][number]) => (j.views ? (Number(j.cost_usd) / j.views) * 1000 : null);
  const rows = useMemo(() => {
    const val = (j: NichePerformance["jobs"][number]) => (sort.key === "views" ? j.views : sort.key === "cost" ? Number(j.cost_usd) : cpp(j));
    return [...perf.jobs].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * sort.dir;
    });
  }, [perf.jobs, sort]);
  const Th = ({ k, children }: { k: SortKey; children: string }) => (
    <th className="px-3 py-2 text-right font-normal" aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : -1 }))} className={cx("hover:text-foreground", sort.key === k && "text-foreground")}>
        {children}
        {sort.key === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
  return (
    <div className="-mx-5 -my-4 overflow-x-auto">
      <table className="w-full min-w-[440px] table-fixed text-[14px]">
        <thead className="border-b border-border text-[12px] text-muted-foreground">
          <tr>
            <th className="w-1/2 px-5 py-2 text-left font-normal">Hook</th>
            <Th k="views">Views</Th>
            <Th k="cost">Cost</Th>
            <Th k="cpp">Per 1k</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((j) => {
            const c = cpp(j);
            return (
              <tr key={j.job_id} onClick={() => router.push(`/content/videos/${j.job_id}`)} className="cursor-pointer transition-colors hover:bg-muted/50">
                <td className="max-w-0 px-5 py-2.5">
                  <Link href={`/content/videos/${j.job_id}`} className="block truncate" onClick={(e) => e.stopPropagation()}>
                    {j.hook ?? <span className="font-mono text-[12px] text-muted-foreground">{j.job_id.slice(0, 8)}</span>}
                  </Link>
                  <span className="text-[12px] text-faint">
                    {platformLabel(j.platform)}
                    {j.status === "failed" && <span className="text-destructive"> · failed</span>}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right tabular">{formatCompact(j.views)}</td>
                <td className="px-3 py-2.5 text-right tabular text-muted-foreground">{formatUsd(j.cost_usd)}</td>
                <td className="px-3 py-2.5 pr-5 text-right tabular text-muted-foreground">{c != null ? formatUsd(c) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const JOBS_LIMIT = 20;

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
  const [make, setMake] = useState<{ platform?: Platform } | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useLiveRefresh((jobs ?? []).some((j) => JOB_IN_PROGRESS.has(j.status)) && !preview);

  const cap = Number(niche.daily_spend_cap_usd);
  const today = Number(spend?.by_niche[niche.id] ?? 0);
  const total30 = Number(spendHistory?.total_usd ?? performance?.summary.total_spend_usd ?? 0);
  const cutoff = Date.now() - 30 * 86400_000;
  const doneInWindow = (jobs ?? []).filter((j) => j.status === "done" && new Date(j.created_at).getTime() >= cutoff).length;
  const truncated = (jobs?.length ?? 0) >= JOBS_LIMIT;
  const s = performance?.summary;
  const hasViews = (performance?.jobs ?? []).some((j) => j.views != null);

  // Daily spend bars for the last 30 days (missing days are zero).
  const days = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const r of spendHistory?.rows ?? []) byDay.set(r.day, (byDay.get(r.day) ?? 0) + Number(r.cost_usd));
    return Array.from({ length: 30 }, (_, i) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - (29 - i));
      return byDay.get(d.toISOString().slice(0, 10)) ?? 0;
    });
  }, [spendHistory]);

  const archive = async () => {
    if (!window.confirm(`Archive “${niche.title}”? It stops making and posting new content.`)) return;
    setArchiving(true);
    const res = await archivePlaybookAction(niche.id);
    setArchiving(false);
    if (res.ok) router.push("/playbooks");
    else setError(res.error ?? "Couldn't archive it.");
  };

  return (
    <>
      <PageHeader icon={<Compass />} title={<Crumbs items={[<Link key="p" href="/playbooks" className="hover:text-foreground">Playbooks</Link>, niche.title]} />}>
        {!niche.archived_at && (
          <Button variant="ghost" size="sm" onClick={() => void archive()} loading={archiving} aria-label="Archive playbook">
            <Archive />
            <span className="hidden sm:inline">Archive</span>
          </Button>
        )}
        <ButtonLink href={`/playbooks/${niche.id}/edit`} size="sm">
          <Pencil />
          Edit
        </ButtonLink>
      </PageHeader>
      <PageBody width="5xl">
        <PageIntro title={niche.title}>{niche.description}</PageIntro>
        <Note tone="danger">{error}</Note>

        <div className="t-stagger space-y-6">
          {!niche.archived_at && niche.platforms.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-[13px] text-muted-foreground">Make a video now</span>
              {niche.platforms.map((p) => (
                <Button key={p} size="sm" onClick={() => setMake({ platform: p })}>
                  {platformLabel(p)}
                </Button>
              ))}
            </div>
          )}
          {niche.archived_at && <Badge>Archived</Badge>}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Today" value={<span className={cap > 0 && today / cap >= 0.8 ? "text-queued" : undefined}>{formatUsd(today)}</span>} delta={<span className="text-[12px] text-muted-foreground tabular">of {formatUsd(cap)}</span>} />
            <Stat label="Spend · 30 days" value={formatUsd(total30)} />
            <Stat label="Per video" value={doneInWindow > 0 ? `${truncated ? "~" : ""}${formatUsd(total30 / doneInWindow)}` : "—"} delta={doneInWindow > 0 ? <span className="text-[12px] text-muted-foreground tabular">{truncated ? "≥" : ""}{doneInWindow} made</span> : undefined} />
            <Stat label="Views · 30 days" value={<span className="text-accent">{hasViews && s ? formatCompact(s.total_views) : "—"}</span>} delta={hasViews && s ? <span className="text-[12px] text-muted-foreground tabular">{costPer1k(s.total_spend_usd, s.total_views)}/1k</span> : undefined} />
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <Panel label="How it runs" className="min-w-0 lg:col-span-3">
              <Meta
                items={[
                  { label: "For", value: niche.target_audience || "—" },
                  { label: "Posts to", value: niche.platforms.length ? niche.platforms.map(platformLabel).join(", ") : "Nowhere yet" },
                  { label: "Cadence", value: <span suppressHydrationWarning>{cadence(niche.posting_windows)}</span> },
                  { label: "Daily cap", value: <CapMeter spent={today} cap={cap} /> },
                  { label: "Approval", value: niche.approve_before_post ? "Reviews each video before it posts" : "Posts on its own" },
                  { label: "Format", value: <span className="tabular">{niche.target_duration_sec}s · {niche.scene_count} scenes · {niche.video_resolution}</span> },
                  { label: "Voice", value: <span className="capitalize">{niche.voice_provider === "elevenlabs" ? "ElevenLabs" : niche.voice}</span> },
                  ...(niche.hashtags.length ? [{ label: "Hashtags", value: niche.hashtags.map((h) => `#${h}`).join(" ") }] : []),
                ]}
              />
            </Panel>
            <div className="min-w-0 space-y-4 lg:col-span-2">
              <Panel label="Spend · last 30 days">
                {days.some((d) => d > 0) ? <Bars values={days} labels={["30 days ago", "Today"]} format={(n) => formatUsd(n)} height={132} /> : <p className="text-[13px] text-muted-foreground">Nothing spent in the last 30 days.</p>}
              </Panel>
              <CharacterSheet nicheId={niche.id} preview={preview} />
            </div>
          </div>

          <Panel label="Performance · 30 days">
              {performance && performance.jobs.length > 0 ? (
                <>
                  <PerformanceTable perf={performance} />
                  {!hasViews && <p className="mt-6 text-[12px] text-muted-foreground">Analytics land about a day after the first post.</p>}
                </>
              ) : (
                <p className="text-[13px] text-muted-foreground">Make a video to start collecting performance.</p>
              )}
          </Panel>

          <section>
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <h2 className="text-[13px] text-muted-foreground">Recent videos</h2>
              <Link href="/content" className="text-[13px] text-muted-foreground hover:text-foreground">
                All content
              </Link>
            </div>
            {jobs && jobs.length > 0 ? (
              <List>
                {jobs.map((j) => (
                  <VideoRow key={j.id} job={j} />
                ))}
              </List>
            ) : (
              <Empty art="files" title="No videos yet" action={!niche.archived_at ? <Button variant="primary" onClick={() => setMake({})}>Make the first one</Button> : undefined}>
                Videos made from this playbook show up here.
              </Empty>
            )}
          </section>

          <section>
            <h2 className="mb-2.5 text-[13px] text-muted-foreground">Ask the Strategist about this playbook</h2>
            <StartSession scope="strategy" lockScope suggestions={[`What's working in ${niche.title}, and what should change?`, "Sharpen the audience and hooks for this playbook", "Plan next week's videos for this playbook"]} />
          </section>
        </div>
      </PageBody>
      <MakeDialog open={make !== null} onClose={() => setMake(null)} niches={[niche]} spend={spend} initial={{ kind: "video", nicheId: niche.id, platform: make?.platform, lockKind: true }} />
    </>
  );
}
