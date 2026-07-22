"use client";

// Square UI "marketing-dashboard" template campaigns-table anatomy, ported
// onto the admin users list — same toolbar-with-search, sortable headers,
// template table chrome, and pagination-footer shape as
// components/square/campaigns-table.tsx / queue/QueueClient.tsx /
// articles/ArticlesClient.tsx. This list is server-paginated (25 rows per
// request), so the adaptation differs from those two in one place: the
// footer's Prev/Next buttons stay mapped to the existing `page` state and
// `hasNext` probe-row logic (unchanged from before) rather than TanStack's
// own pagination — sorting still runs client-side over the current page's
// rows via getSortedRowModel, same as the other tables.
//   - the search box (already existed) is wired into the template's
//     toolbar box + icon.
//   - no "New user" action — admins don't create user accounts, so
//     (like the template columns with no real counterpart) that primary
//     action button is dropped rather than faked.
//   - no status/role filter dropdown — the original list had none, so
//     none is invented.

import * as React from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
} from "lucide-react";

import { AccountStatusBadge, RoleBadge } from "@/components/admin/badges";
import { relativeTime } from "@/components/admin/format";
import { Button } from "@/components/square/ui/button";
import { Input } from "@/components/square/ui/input";
import { Card, CardContent } from "@/components/square/ui/card";
import { Skeleton } from "@/components/square/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/square/ui/table";
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

function SortableHeader({
  label,
  onClick,
  className,
}: {
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      className={`h-auto p-0 font-medium text-xs hover:bg-transparent ${className ?? ""}`}
      onClick={onClick}
    >
      {label} <ChevronsUpDown className="ml-1 size-3" />
    </Button>
  );
}

export function UsersClient({ initial }: { initial: AdminUserRow[] }) {
  const router = useRouter();
  const [rawQuery, setRawQuery] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [sorting, setSorting] = React.useState<SortingState>([]);

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

  const columns = React.useMemo<ColumnDef<AdminUserRow>[]>(
    () => [
      {
        id: "email",
        accessorFn: (row) => row.user.email,
        header: ({ column }) => (
          <SortableHeader
            label="Email"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/admin/users/${row.original.user.id}`);
            }}
            className="block max-w-[280px] truncate text-left text-sm font-medium underline-offset-4 hover:underline"
          >
            {row.original.user.email}
          </button>
        ),
      },
      {
        id: "role",
        accessorFn: (row) => row.user.role,
        header: ({ column }) => (
          <SortableHeader
            label="Role"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => <RoleBadge role={row.original.user.role} />,
      },
      {
        id: "status",
        accessorFn: (row) => (row.user.suspended_at ? "suspended" : "active"),
        header: ({ column }) => (
          <SortableHeader
            label="Status"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => <AccountStatusBadge user={row.original.user} />,
      },
      {
        accessorKey: "niche_count",
        header: ({ column }) => (
          <SortableHeader
            label="Niches"
            className="ml-auto"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span className="block text-right text-sm tabular-nums text-muted-foreground">
            {row.original.niche_count}
          </span>
        ),
      },
      {
        accessorKey: "job_count",
        header: ({ column }) => (
          <SortableHeader
            label="Jobs"
            className="ml-auto"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span className="block text-right text-sm tabular-nums text-muted-foreground">
            {row.original.job_count}
          </span>
        ),
      },
      {
        accessorKey: "article_count",
        header: ({ column }) => (
          <SortableHeader
            label="Articles"
            className="ml-auto"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span className="block text-right text-sm tabular-nums text-muted-foreground">
            {row.original.article_count}
          </span>
        ),
      },
      {
        id: "spend",
        accessorFn: (row) => Number(row.spend_total_usd),
        header: ({ column }) => (
          <SortableHeader
            label="Spend"
            className="ml-auto"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span className="block text-right font-mono text-sm tabular-nums">
            {formatUsd(row.original.spend_total_usd)}
          </span>
        ),
      },
      {
        id: "joined",
        accessorFn: (row) => row.user.created_at,
        header: ({ column }) => (
          <SortableHeader
            label="Joined"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {relativeTime(row.original.user.created_at)}
          </span>
        ),
      },
    ],
    [router],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">
          Search, inspect, and administer every account.
        </p>
      </div>

      {error && (
        <p className="text-sm text-muted-foreground">
          Live updates paused — {error.message ?? "fetch failed"}
        </p>
      )}

      <div className="rounded-lg border bg-card flex flex-col">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-4 border-b">
          <div className="relative flex-1 w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              placeholder="Search by email..."
              aria-label="Search users by email"
              className="pl-9 h-8 text-sm"
            />
          </div>
        </div>

        {showInitialSkeleton ? (
          <LoadingTable />
        ) : rows.length === 0 ? (
          <EmptyState query={query} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id} className="hover:bg-transparent">
                    {headerGroup.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        className="text-xs font-medium text-muted-foreground h-10 whitespace-nowrap"
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="border-b last:border-0 hover:bg-muted/30 cursor-pointer"
                    onClick={() => router.push(`/admin/users/${row.original.user.id}`)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="py-3 whitespace-nowrap">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {rows.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-4 py-3 border-t">
            <p className="text-sm tabular-nums text-muted-foreground">
              Showing {rangeStart}–{rangeEnd}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="size-3.5" aria-hidden />
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1"
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
    </div>
  );
}

function LoadingTable() {
  return (
    <CardContent className="space-y-3 py-5">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="ml-auto h-4 w-20" />
        </div>
      ))}
    </CardContent>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <Card className="border-none shadow-none">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
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
