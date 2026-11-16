"use client";

import { Compass, Pencil } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { departmentById } from "@/lib/departments";
import { formatCompact, formatUsd } from "@/lib/format";
import type { Niche, NichePerformance, Platform, TodaySpend } from "@/lib/types";
import { StartSession } from "../agent/start-session";
import { PageBody, PageHeader, PageIntro } from "../page";
import { Badge, Button, ButtonLink, cx, Empty, Sparkbars } from "../ui";
import { MakeDialog } from "../content/make-dialog";
import { platformLabel } from "../content/status";
import { cadence } from "./format";

export function costPer1k(spend: string | number, views: number) {
  const s = Number(spend);
  return views > 0 && Number.isFinite(s) ? formatUsd((s / views) * 1000) : "—";
}

export function CapMeter({ spent, cap }: { spent: number; cap: number }) {
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
  const hot = pct >= 80;
  return (
    <span className="block">
      <span className="tabular">
        <span className={hot ? "text-queued" : undefined}>{formatUsd(spent)}</span>
        <span className="text-muted-foreground"> of {formatUsd(cap)}</span>
      </span>
      <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-muted">
        <span className={cx("block h-full rounded-full", hot ? "bg-queued" : "bg-foreground/50")} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("min-w-0", className)}>
      <div className="text-[12px] text-faint">{label}</div>
      <div className="mt-0.5 text-[14px]">{children}</div>
    </div>
  );
}

function PlaybookCard({ niche, perf, spent, onMake }: { niche: Niche; perf: NichePerformance | null | undefined; spent: number; onMake: (p?: Platform) => void }) {
  const s = perf?.summary;
  const hasViews = (perf?.jobs ?? []).some((j) => j.views != null);
  const viewSeries = [...(perf?.jobs ?? [])].reverse().map((j) => j.views ?? 0);
  return (
    <article className="min-w-0 rounded-[20px] border border-border bg-card">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 px-5 pb-4 pt-4">
        <Link href={`/playbooks/${niche.id}`} className="min-w-0 flex-1 basis-[240px]">
          <h3 className="flex items-center gap-2 text-[15px] font-medium">
            <span className="truncate">{niche.title}</span>
            {niche.archived_at && <Badge>Archived</Badge>}
          </h3>
          <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{niche.description}</p>
        </Link>
        <div className="flex shrink-0 items-center gap-1.5">
          <ButtonLink href={`/playbooks/${niche.id}/edit`} variant="ghost" size="sm" aria-label={`Edit ${niche.title}`}>
            <Pencil />
            <span className="hidden sm:inline">Edit</span>
          </ButtonLink>
          <Button size="sm" onClick={() => onMake()} disabled={Boolean(niche.archived_at)}>
            Make a video
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border px-5 py-4 lg:grid-cols-4">
        <Fact label="For" className="col-span-2">
          <span className="line-clamp-2">{niche.target_audience || "—"}</span>
        </Fact>
        <Fact label="Posts to">
          <span className="flex flex-wrap gap-1">
            {niche.platforms.length ? niche.platforms.map((p) => <Badge key={p}>{platformLabel(p)}</Badge>) : <span className="text-muted-foreground">Nowhere yet</span>}
          </span>
        </Fact>
        <Fact label="Cadence">
          <span suppressHydrationWarning>{cadence(niche.posting_windows)}</span>
        </Fact>
        <Fact label="Today's spend" className="col-span-2 sm:col-span-1">
          <CapMeter spent={spent} cap={Number(niche.daily_spend_cap_usd)} />
        </Fact>
        <Fact label="Approval">{niche.approve_before_post ? "Reviews before posting" : <span>Posts on its own</span>}</Fact>
        <Fact label="Look" className="col-span-2">
          <span className="line-clamp-1 text-muted-foreground">{niche.visual_style || "—"}</span>
        </Fact>
      </div>
      <Link href={`/playbooks/${niche.id}`} className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 rounded-b-[20px] border-t border-border bg-subtle px-5 py-3.5 transition-colors hover:bg-muted/50">
        {s && s.total_videos > 0 ? (
          <>
            <dl className="flex flex-wrap gap-x-6 gap-y-2">
              <div>
                <dt className="text-[12px] text-faint">Videos · 30d</dt>
                <dd className="text-[15px] font-medium tabular">{s.total_videos}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-faint">Views</dt>
                <dd className="text-[15px] font-medium tabular text-accent">{hasViews ? formatCompact(s.total_views) : "—"}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-faint">Spend</dt>
                <dd className="text-[15px] font-medium tabular">{formatUsd(s.total_spend_usd)}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-faint">Per 1k views</dt>
                <dd className="text-[15px] font-medium tabular">{hasViews ? costPer1k(s.total_spend_usd, s.total_views) : "—"}</dd>
              </div>
            </dl>
            {hasViews && <Sparkbars values={viewSeries} />}
          </>
        ) : (
          <span className="text-[13px] text-muted-foreground">No videos in the last 30 days. Make one to start learning what works.</span>
        )}
      </Link>
    </article>
  );
}

export function PlaybooksView({ niches, performance, spend }: { niches: Niche[] | null; performance: Record<string, NichePerformance | null>; spend: TodaySpend | null }) {
  const dept = departmentById("strategy")!;
  const [make, setMake] = useState<{ nicheId: string; platform?: Platform } | null>(null);
  const list = niches ?? [];
  const active = list.filter((n) => !n.archived_at);
  const archived = list.filter((n) => n.archived_at);
  return (
    <>
      <PageHeader icon={<Compass />} title="Playbooks">
        <ButtonLink href="/playbooks/new" variant="primary" size="sm">
          New playbook
        </ButtonLink>
      </PageHeader>
      <PageBody width="5xl">
        <PageIntro title="Playbooks">Who to talk to, how to sound, what to make and where to post. Every department works from these.</PageIntro>
        <div className="t-stagger space-y-8">
          <StartSession scope="strategy" lockScope suggestions={dept.asks} />
          {niches === null ? (
            <Empty art="activity" title="Couldn't load playbooks">The API didn't answer. Try again in a moment.</Empty>
          ) : list.length === 0 ? (
            <Empty art="people" title="No playbooks yet" action={<ButtonLink href="/playbooks/new" variant="primary">Create your first playbook</ButtonLink>}>
              Describe your audience in a sentence and the Strategist drafts the rest. Each playbook runs under its own daily cap.
            </Empty>
          ) : (
            <section className="space-y-3">
              {active.map((n) => (
                <PlaybookCard key={n.id} niche={n} perf={performance[n.id]} spent={Number(spend?.by_niche[n.id] ?? 0)} onMake={(p) => setMake({ nicheId: n.id, platform: p })} />
              ))}
              {archived.length > 0 && (
                <details className="group pt-2">
                  <summary className="cursor-pointer list-none text-[13px] text-muted-foreground hover:text-foreground">Archived · {archived.length}</summary>
                  <div className="mt-3 space-y-3">
                    {archived.map((n) => (
                      <PlaybookCard key={n.id} niche={n} perf={performance[n.id]} spent={0} onMake={() => {}} />
                    ))}
                  </div>
                </details>
              )}
            </section>
          )}
        </div>
      </PageBody>
      <MakeDialog open={make !== null} onClose={() => setMake(null)} niches={list} spend={spend} initial={make ? { kind: "video", nicheId: make.nicheId, platform: make.platform, lockKind: true } : undefined} />
    </>
  );
}
