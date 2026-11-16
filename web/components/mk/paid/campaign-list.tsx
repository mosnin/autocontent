"use client";

import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { formatUsd } from "@/lib/format";
import type { AdAccount, AdCampaign } from "@/lib/ads-client";
import { Button, Input, Segmented } from "../ui";
import { useAutoRefresh } from "../settings/primitives";
import { accountName, AdStatusBadge, platformLabel, PlatformTile } from "./shared";

type Filter = "all" | "active" | "paused" | "draft" | "other";
const PAGE = 8;

/** Every ad campaign: search, a status filter and paging, refreshed every 30s. */
export function CampaignList({ campaigns, accounts }: { campaigns: AdCampaign[]; accounts: AdAccount[] }) {
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
        <div className="relative min-w-0 flex-1 basis-[200px] sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <Input value={q} onChange={(e) => (setQ(e.target.value), setPage(0))} placeholder="Search campaigns" aria-label="Search campaigns" className="h-9 py-1.5 pl-8" />
        </div>
        <Segmented
          label="Filter by status"
          value={filter}
          onChange={(v) => (setFilter(v), setPage(0))}
          className="w-full sm:w-auto"
          options={[
            { value: "all", label: "All" },
            { value: "active", label: "Live" },
            { value: "paused", label: "Paused" },
            { value: "draft", label: "Drafts" },
            { value: "other", label: "Ended" },
          ]}
        />
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-card">
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">No campaigns match.</p>
        ) : (
          shown.map((c) => {
            const acc = byId[c.ad_account_id];
            return (
              <Link key={c.id} href={`/paid/campaigns/${c.id}`} className="flex min-h-[52px] items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-muted/50">
                <PlatformTile platform={acc?.platform ?? "ads"} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{c.name}</span>
                  <span className="block truncate text-[13px] capitalize text-muted-foreground">
                    {acc ? `${platformLabel(acc.platform)} · ${accountName(acc)}` : "—"}
                    {c.objective ? ` · ${c.objective.replace(/_/g, " ")}` : ""}
                  </span>
                </span>
                <span className="hidden shrink-0 text-right sm:block">
                  <span className="block text-[13px] tabular">{c.daily_budget_usd ? `${formatUsd(c.daily_budget_usd)}/day` : "—"}</span>
                </span>
                <AdStatusBadge status={c.status} />
              </Link>
            );
          })
        )}
      </div>
      {rows.length > PAGE && (
        <div className="flex items-center justify-between gap-3 text-[13px] text-muted-foreground">
          <span className="tabular">
            {p * PAGE + 1}–{Math.min(rows.length, p * PAGE + PAGE)} of {rows.length}
          </span>
          <span className="flex items-center gap-1">
            <Button size="icon" variant="ghost" className="size-8" aria-label="Previous page" disabled={p === 0} onClick={() => setPage(p - 1)}>
              <ChevronLeft />
            </Button>
            <Button size="icon" variant="ghost" className="size-8" aria-label="Next page" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>
              <ChevronRight />
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}
