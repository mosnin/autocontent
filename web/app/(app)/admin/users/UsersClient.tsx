"use client";

import { ArrowDownUp, ChevronLeft, ChevronRight, Search } from "lucide-react";
import * as React from "react";
import useSWR from "swr";
import { AdminFrame } from "@/components/app/admin/admin-frame";
import { AccountStatusBadge, RoleBadge } from "@/components/app/admin/badges";
import { relativeTime } from "@/components/app/admin/format";
import { Button, EmptyLine, FilterPill, Input, Notice, Skeleton, Card, Table } from "@/design-system";
import { adminKeys } from "@/lib/admin-api";
import type { AdminUserRow } from "@/lib/admin-types";
import { clientFetch } from "@/lib/client-fetcher";
import { formatUsd } from "@/lib/format";

export const PAGE_SIZE = 25;
// We fetch one extra row past the page size purely to detect whether a next
// page exists. If the API hands back PAGE_SIZE + 1 rows there's more to see;
// we display only the first PAGE_SIZE.
export const FETCH_LIMIT = PAGE_SIZE + 1;
const POLL_MS = 15_000;

type Sort = "newest" | "oldest" | "email" | "spend" | "jobs";
const SORTS: { value: Sort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "email", label: "Email A–Z" },
  { value: "spend", label: "Most spend" },
  { value: "jobs", label: "Most jobs" },
];

// Sorting runs over the current page only; the list is server-paginated.
function sortRows(rows: AdminUserRow[], sort: Sort): AdminUserRow[] {
  const out = [...rows];
  const t = (r: AdminUserRow) => new Date(r.user.created_at).getTime();
  if (sort === "newest") out.sort((a, b) => t(b) - t(a));
  if (sort === "oldest") out.sort((a, b) => t(a) - t(b));
  if (sort === "email") out.sort((a, b) => a.user.email.localeCompare(b.user.email));
  if (sort === "spend") out.sort((a, b) => Number(b.spend_total_usd) - Number(a.spend_total_usd));
  if (sort === "jobs") out.sort((a, b) => b.job_count - a.job_count);
  return out;
}

export function UsersClient({ initial }: { initial: AdminUserRow[] }) {
  const [rawQuery, setRawQuery] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [sort, setSort] = React.useState<Sort>("newest");

  // Debounce the search box so we don't hit the API on every keystroke.
  React.useEffect(() => {
    const t = setTimeout(() => {
      setQuery(rawQuery.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [rawQuery]);

  const key = adminKeys.users({ q: query || undefined, limit: FETCH_LIMIT, offset: page * PAGE_SIZE });
  const { data, error, isLoading } = useSWR<AdminUserRow[]>(key, clientFetch, {
    refreshInterval: POLL_MS,
    keepPreviousData: true,
    // Only seed the first, unfiltered page from the server payload.
    fallbackData: query === "" && page === 0 ? initial : undefined,
  });

  const raw = data ?? [];
  const hasNext = raw.length > PAGE_SIZE;
  const rows = sortRows(hasNext ? raw.slice(0, PAGE_SIZE) : raw, sort);
  const rangeStart = rows.length === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = page * PAGE_SIZE + rows.length;

  return (
    <AdminFrame
      crumbs={[{ label: "Users" }]}
      toolbar={
        <>
          <div className="relative w-full sm:w-64">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-faint" />
            <Input value={rawQuery} onChange={(e) => setRawQuery(e.target.value)} placeholder="Search by email" aria-label="Search users by email" className="h-7 pl-8" />
          </div>
          <FilterPill label="Sort" icon={<ArrowDownUp />} value={sort} options={SORTS} onChange={setSort} />
        </>
      }
      toolbarEnd={
        rows.length > 0 ? (
          <>
            <span className="text-[12px] text-fg-faint tabular">
              {rangeStart}–{rangeEnd}
            </span>
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <Button size="sm" variant="ghost" disabled={!hasNext} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
              <ChevronRight />
            </Button>
          </>
        ) : undefined
      }
    >
      {error && <Notice error={`Live updates paused: ${error.message ?? "fetch failed"}`} />}
      {isLoading && !data ? (
        <Card className="space-y-3 p-3.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-3.5 w-56" />
              <Skeleton className="ml-auto h-3.5 w-20" />
            </div>
          ))}
        </Card>
      ) : (
        <Table<AdminUserRow>
          rows={rows}
          rowKey={(r) => r.user.id}
          rowHref={(r) => `/admin/users/${r.user.id}`}
          empty={<EmptyLine>{query ? `No users match “${query}”.` : "Accounts appear here as people sign up."}</EmptyLine>}
          columns={[
            { key: "email", label: "Email", render: (r) => <span className="block max-w-[280px] truncate font-medium">{r.user.email}</span> },
            { key: "role", label: "Role", render: (r) => <RoleBadge role={r.user.role} /> },
            { key: "status", label: "Status", hideOnPhone: true, render: (r) => <AccountStatusBadge user={r.user} /> },
            { key: "niches", label: "Niches", align: "right", hideOnPhone: true, render: (r) => <span className="text-fg-muted">{r.niche_count}</span> },
            { key: "jobs", label: "Jobs", align: "right", hideOnPhone: true, render: (r) => <span className="text-fg-muted">{r.job_count}</span> },
            { key: "articles", label: "Articles", align: "right", hideOnPhone: true, render: (r) => <span className="text-fg-muted">{r.article_count}</span> },
            { key: "spend", label: "Spend", align: "right", render: (r) => formatUsd(r.spend_total_usd) },
            { key: "joined", label: "Joined", align: "right", hideOnPhone: true, render: (r) => <span className="text-fg-muted">{relativeTime(r.user.created_at)}</span> },
          ]}
        />
      )}
    </AdminFrame>
  );
}
