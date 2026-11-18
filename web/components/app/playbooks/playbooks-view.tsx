"use client";

import { useState } from "react";
import { Button, ButtonLink, Column, EmptyLine, Meter, PageHeader, Section, Segmented, Table, StatLine, ToolTitle } from "@/design-system";
import { TOOL_ICON } from "@/components/shell/sidebar";
import { StartSession } from "@/components/chat/start-session";
import { formatCompact, formatUsd } from "@/lib/format";
import type { Niche, NichePerformance, Platform, TodaySpend } from "@/lib/types";
import { MakeDialog } from "../content/make-dialog";
import { toolGlyph } from "../content/shared";
import { platformLabel } from "../content/status";
import { cadence } from "./format";

export function costPer1k(spend: string | number, views: number) {
  const s = Number(spend);
  return views > 0 && Number.isFinite(s) ? formatUsd((s / views) * 1000) : "—";
}

/** "$1.20 of $5.00" over a thin meter; orange from 80%. */
export function CapMeter({ spent, cap }: { spent: number; cap: number }) {
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
  const hot = pct >= 80;
  return (
    <span className="block min-w-[96px] space-y-1">
      <span className="block tabular">
        <span className={hot ? "text-attention" : undefined}>{formatUsd(spent)}</span>
        <span className="text-fg-muted"> of {formatUsd(cap)}</span>
      </span>
      <Meter value={pct} tone={hot ? "attention" : "accent"} label="Today's spend against the cap" />
    </span>
  );
}

type View = "active" | "archived";

/** Playbooks (Tool template): scoped Strategist composer, then every playbook in one table. */
export function PlaybooksView({ niches, performance, spend }: { niches: Niche[] | null; performance: Record<string, NichePerformance | null>; spend: TodaySpend | null }) {
  const [make, setMake] = useState<{ nicheId: string; platform?: Platform } | null>(null);
  const [view, setView] = useState<View>("active");
  const list = niches ?? [];
  const active = list.filter((n) => !n.archived_at);
  const archived = list.filter((n) => n.archived_at);
  const rows = view === "active" ? active : archived;
  const spentToday = active.reduce((s, n) => s + Number(spend?.by_niche[n.id] ?? 0), 0);
  const capTotal = active.reduce((s, n) => s + Number(n.daily_spend_cap_usd || 0), 0);
  const videos30 = active.reduce((s, n) => s + (performance[n.id]?.summary.total_videos ?? 0), 0);
  const views30 = active.reduce((s, n) => s + (performance[n.id]?.summary.total_views ?? 0), 0);

  return (
    <>
      <PageHeader
        icon={toolGlyph("strategy")}
        title="Playbooks"
        actions={
          <ButtonLink href="/playbooks/new" variant="primary">
            New playbook
          </ButtonLink>
        }
      />
      <Column
        width="lg"
        title={<ToolTitle icon={TOOL_ICON.strategy.icon} tone={TOOL_ICON.strategy.tone}>Playbooks</ToolTitle>}
        description="Who to talk to, how to sound and where to post."
        control={
          archived.length > 0 ? (
            <Segmented
              value={view}
              onChange={setView}
              label="Playbook status"
              options={[
                { value: "active", label: <>Active <span className="text-fg-faint tabular">{active.length}</span></> },
                { value: "archived", label: <>Archived <span className="text-fg-faint tabular">{archived.length}</span></> },
              ]}
            />
          ) : undefined
        }
      >
        <div className="space-y-4">
          <StartSession scope="strategy" lockScope />
          {active.length > 0 && (
            <StatLine
              items={[
                { label: "active", value: active.length },
                { label: capTotal > 0 ? `of ${formatUsd(capTotal, { cents: false })} spent today` : "spent today", value: formatUsd(spentToday) },
                { label: "videos in 30 days", value: videos30 },
                { label: "views in 30 days", value: formatCompact(views30) },
              ]}
            />
          )}
        </div>

        <Section title={view === "active" ? "Playbooks" : "Archived"}>
          {niches === null ? (
            <EmptyLine>Couldn&apos;t load playbooks. Try again in a moment.</EmptyLine>
          ) : list.length === 0 ? (
            <EmptyLine
              action={
                <ButtonLink href="/playbooks/new" variant="primary">
                  Create a playbook
                </ButtonLink>
              }
            >
              No playbooks yet.
            </EmptyLine>
          ) : (
            <Table
              rows={rows}
              rowKey={(n) => n.id}
              rowHref={(n) => `/playbooks/${n.id}`}
              empty={<EmptyLine>Nothing here.</EmptyLine>}
              columns={[
                {
                  key: "name",
                  label: "Playbook",
                  render: (n) => (
                    <span className="block min-w-0 py-1.5">
                      <span className="line-clamp-1 font-medium">{n.title}</span>
                      <span className="line-clamp-1 text-[12px] text-fg-muted">{n.target_audience || n.description}</span>
                    </span>
                  ),
                },
                { key: "platforms", label: "Posts to", hideOnPhone: true, width: "130px", render: (n) => <span className="text-fg-muted">{n.platforms.length ? n.platforms.map(platformLabel).join(", ") : "Nowhere yet"}</span> },
                { key: "cadence", label: "Cadence", hideOnPhone: true, width: "170px", render: (n) => <span className="line-clamp-1 text-fg-muted" suppressHydrationWarning>{cadence(n.posting_windows)}</span> },
                ...(view === "active"
                  ? [{ key: "today", label: "Today", hideOnPhone: true, width: "130px", render: (n: Niche) => <CapMeter spent={Number(spend?.by_niche[n.id] ?? 0)} cap={Number(n.daily_spend_cap_usd)} /> }]
                  : []),
                {
                  key: "views",
                  label: "Views · 30d",
                  align: "right" as const,
                  width: "96px",
                  render: (n: Niche) => {
                    const s = performance[n.id]?.summary;
                    const has = (performance[n.id]?.jobs ?? []).some((j) => j.views != null);
                    return has && s ? formatCompact(s.total_views) : <span className="text-fg-faint">—</span>;
                  },
                },
                ...(view === "active"
                  ? [
                      {
                        key: "make",
                        label: <span className="sr-only">Make</span>,
                        align: "right" as const,
                        width: "92px",
                        render: (n: Niche) => (
                          <span className="relative z-10 inline-flex">
                            <Button size="sm" onClick={() => setMake({ nicheId: n.id })}>
                              Make video
                            </Button>
                          </span>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </Section>
      </Column>
      <MakeDialog open={make !== null} onClose={() => setMake(null)} niches={list} spend={spend} initial={make ? { kind: "video", nicheId: make.nicheId, platform: make.platform, lockKind: true } : undefined} />
    </>
  );
}
