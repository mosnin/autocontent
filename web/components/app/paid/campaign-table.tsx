"use client";

import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyLine, FilterPill, IconButton, Input, Table } from "@/design-system";
import type { AdAccount, AdCampaign } from "@/lib/ads-client";
import { formatUsd } from "@/lib/format";
import { useAutoRefresh } from "@/lib/proxy-fetch";
import { accountName, AdStatusBadge, platformLabel, PlatformTile } from "./shared";

type Filter = "all" | "active" | "paused" | "draft" | "other";
const PAGE = 8;

/** Every ad campaign: search, a status filter and paging, refreshed every 30s. */
export function CampaignTable({ campaigns, accounts }: { campaigns: AdCampaign[]; accounts: AdAccount[] }) {
  useAutoRefresh(30_000);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  const byId = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts]);

  const rows = useMemo(() => {
    let r = campaigns;
    if (q.trim()) r = r.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()));
    if (filter === "other") r = r.filter((c) => !["active", "paused", "draft"].includes(c.status));
    else if (filter !== "all") r = r.filter((c) => c.status === filter);
    return r;
  }, [campaigns, q, filter]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const p = Math.min(page, pages - 1);
  const shown = rows.slice(p * PAGE, p * PAGE + PAGE);

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-[180px] sm:max-w-[240px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-faint" />
          <Input value={q} onChange={(e) => (setQ(e.target.value), setPage(0))} placeholder="Search campaigns" aria-label="Search campaigns" className="pl-8" />
        </div>
        <FilterPill
          label="Filter by status"
          value={filter}
          onChange={(v) => (setFilter(v), setPage(0))}
          options={[
            { value: "all", label: "All statuses" },
            { value: "active", label: "Live" },
            { value: "paused", label: "Paused" },
            { value: "draft", label: "Drafts" },
            { value: "other", label: "Ended" },
          ]}
        />
      </div>
      <Table
        rows={shown}
        rowKey={(c) => c.id}
        rowHref={(c) => `/paid/campaigns/${c.id}`}
        empty={<EmptyLine>No campaigns match.</EmptyLine>}
        columns={[
          {
            key: "name",
            label: "Campaign",
            render: (c) => {
              const acc = byId[c.ad_account_id];
              return (
                <span className="flex min-w-0 items-center gap-2.5">
                  <PlatformTile platform={acc?.platform ?? "ads"} size={24} />
                  <span className="min-w-0">
                    <span className="block truncate">{c.name}</span>
                    <span className="block truncate text-[12px] capitalize text-fg-muted">{c.objective ? c.objective.replace(/_/g, " ") : "No objective"}</span>
                  </span>
                </span>
              );
            },
          },
          { key: "account", label: "Account", hideOnPhone: true, render: (c) => <span className="text-fg-muted">{byId[c.ad_account_id] ? `${platformLabel(byId[c.ad_account_id]!.platform)} · ${accountName(byId[c.ad_account_id]!)}` : "—"}</span> },
          { key: "budget", label: "Per day", align: "right", hideOnPhone: true, render: (c) => (c.daily_budget_usd ? formatUsd(c.daily_budget_usd) : "—") },
          { key: "status", label: "Status", align: "right", width: "88px", render: (c) => <AdStatusBadge status={c.status} /> },
        ]}
      />
      {rows.length > PAGE && (
        <div className="flex items-center justify-between gap-3 text-[12px] text-fg-muted">
          <span className="tabular">
            {p * PAGE + 1}–{Math.min(rows.length, p * PAGE + PAGE)} of {rows.length}
          </span>
          <span className="flex items-center gap-1">
            <IconButton label="Previous page" disabled={p === 0} onClick={() => setPage(p - 1)}>
              <ChevronLeft />
            </IconButton>
            <IconButton label="Next page" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>
              <ChevronRight />
            </IconButton>
          </span>
        </div>
      )}
    </div>
  );
}
