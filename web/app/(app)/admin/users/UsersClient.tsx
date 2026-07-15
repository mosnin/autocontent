"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Search, Users } from "lucide-react";

import { AccountStatusBadge, RoleBadge } from "@/components/admin/badges";
import { relativeTime } from "@/components/admin/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminKeys } from "@/lib/admin-api";
import { clientFetch } from "@/lib/client-fetcher";
import { formatUsd } from "@/lib/format";
import type { AdminUserRow } from "@/lib/admin-types";

export const PAGE_SIZE = 25;
// We fetch one extra row past the page size purely to detect whether a next
// page exists. If the API hands back PAGE_SIZE + 1 rows there's more to see;
// we display only the first PAGE_SIZE. This kills the classic off-by-one
// where a perfectly full final page still offered an empty "Next".
export const FETCH_LIMIT = PAGE_SIZE + 1;
const POLL_MS = 15_000;

export function UsersClient({ initial }: { initial: AdminUserRow[] }) {
  const router = useRouter();
  const [rawQuery, setRawQuery] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [page, setPage] = React.useState(0);

  // Debounce the search box so we don't hit the API on every keystroke.
  React.useEffect(() => {
    const t = setTimeout(() => {
      setQuery(rawQuery.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [rawQuery]);

  const key = adminKeys.users({
    q: query || undefined,
    limit: FETCH_LIMIT,
    offset: page * PAGE_SIZE,
  });

  const { data, error, isLoading } = useSWR<AdminUserRow[]>(key, clientFetch, {
    refreshInterval: POLL_MS,
    keepPreviousData: true,
    // Only seed the first, unfiltered page from the server payload.
    fallbackData: query === "" && page === 0 ? initial : undefined,
  });

  const errorToastedRef = React.useRef(false);
  React.useEffect(() => {
    if (error && !errorToastedRef.current) {
      errorToastedRef.current = true;
      toast.error(`Live updates paused: ${error.message ?? "fetch failed"}`);
    }
    if (!error) errorToastedRef.current = false;
  }, [error]);

  const raw = data ?? [];
  const hasNext = raw.length > PAGE_SIZE;
  const rows = hasNext ? raw.slice(0, PAGE_SIZE) : raw;
  const showInitialSkeleton = isLoading && !data;
  const rangeStart = rows.length === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = page * PAGE_SIZE + rows.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">
          Search, inspect, and administer every account.
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={rawQuery}
          onChange={(e) => setRawQuery(e.target.value)}
          placeholder="Search by email…"
          aria-label="Search users by email"
          className="pl-9"
        />
      </div>

      {error && (
        <p className="text-sm text-muted-foreground">
          Live updates paused — {error.message ?? "fetch failed"}
        </p>
      )}

      {showInitialSkeleton ? (
        <LoadingTable />
      ) : rows.length === 0 ? (
        <EmptyState query={query} />
      ) : (
        <div className="overflow-x-auto">
          <Card className="min-w-[760px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead className="w-[110px]">Role</TableHead>
                  <TableHead className="w-[110px]">Status</TableHead>
                  <TableHead className="w-[80px] text-right">Niches</TableHead>
                  <TableHead className="w-[80px] text-right">Jobs</TableHead>
                  <TableHead className="w-[90px] text-right">Articles</TableHead>
                  <TableHead className="w-[100px] text-right">Spend</TableHead>
                  <TableHead className="w-[110px]">Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <UserRow
                    key={row.user.id}
                    row={row}
                    onOpen={() => router.push(`/admin/users/${row.user.id}`)}
                  />
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs tabular-nums text-muted-foreground">
            Showing {rangeStart}–{rangeEnd}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft className="size-3.5" aria-hidden />
              Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!hasNext}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight className="size-3.5" aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function UserRow({
  row,
  onOpen,
}: {
  row: AdminUserRow;
  onOpen: () => void;
}) {
  const { user } = row;
  return (
    <TableRow
      // The row stays a real table row (keeps its grid semantics for AT).
      // Pointer users can click anywhere for convenience; keyboard/AT users
      // get a genuine focusable control in the email cell below.
      onClick={onOpen}
      className="cursor-pointer transition-colors hover:bg-muted/40 focus-within:bg-muted/40"
    >
      <TableCell className="max-w-[280px] font-medium">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="block max-w-full truncate text-left underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {user.email}
        </button>
      </TableCell>
      <TableCell>
        <RoleBadge role={user.role} />
      </TableCell>
      <TableCell>
        <AccountStatusBadge user={user} />
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {row.niche_count}
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {row.job_count}
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {row.article_count}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {formatUsd(row.spend_total_usd)}
      </TableCell>
      <TableCell className="tabular-nums text-muted-foreground">
        {relativeTime(user.created_at)}
      </TableCell>
    </TableRow>
  );
}

function LoadingTable() {
  return (
    <Card className="min-w-[760px]">
      <CardContent className="space-y-3 py-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="ml-auto h-4 w-20" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="rounded-full bg-muted p-3">
          <Users className="h-6 w-6 text-muted-foreground" aria-hidden />
        </div>
        <h3 className="text-lg font-semibold">
          {query ? "No matching users" : "No users yet"}
        </h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          {query
            ? `Nothing matched “${query}”. Try a different email.`
            : "Accounts will appear here as people sign up."}
        </p>
      </CardContent>
    </Card>
  );
}
