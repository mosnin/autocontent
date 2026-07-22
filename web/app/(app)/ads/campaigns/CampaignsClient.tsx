"use client";

// Square UI "marketing-dashboard" template campaigns-table, ported to the
// ads campaigns list — same TanStack table anatomy (toolbar with search +
// filter dropdown + primary action, sortable headers, row-selection
// checkbox column, template badge palette, full pagination footer) as
// components/square/campaigns-table.tsx / the queue's QueueClient.
// Adaptations are real-data mapping + our routes only:
//   - the `campaigns` prop is the real AdCampaign type (SWR-polled, same as
//     before); columns map to real fields: name, status, objective, daily
//     budget, and the ad account it runs on (resolved from the accounts
//     list the page already fetches — real label or "—", never invented);
//   - statuses are ours (draft/pending/active/paused/ended/failed) on the
//     template's badge palette, extended with two extra tones (blue,
///    rose) the same way QueueClient did for its own extra states;
//   - the template's zustand store becomes local state (same behavior);
//   - the template's mock avatar + "Sort" platform dropdown are dropped —
//     no image asset or platform field exists on a campaign;
//   - campaign names link to the real campaign detail page and the
//     New-campaign button links to the existing /ads/campaigns/new route;
//   - the account-gate empty state (connect first) is unchanged.

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import {
  Plus,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
} from "lucide-react";

import { Button } from "@/components/square/ui/button";
import { Checkbox } from "@/components/square/ui/checkbox";
import { Input } from "@/components/square/ui/input";
import { Badge } from "@/components/square/ui/badge";
import { Card, CardContent } from "@/components/square/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/square/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/square/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/square/ui/table";
import { cn } from "@/lib/utils";
import { clientFetch } from "@/lib/client-fetcher";
import { formatUsd } from "@/lib/format";
import { adsKeys, type AdAccount, type AdCampaign } from "@/lib/ads-client";

type Status = AdCampaign["status"];

const STATUSES: Status[] = [
  "draft",
  "pending",
  "active",
  "paused",
  "ended",
  "failed",
];

const STATUS_LABEL: Record<Status, string> = {
  draft: "Draft",
  pending: "Pending",
  active: "Active",
  paused: "Paused",
  ended: "Ended",
  failed: "Failed",
};

// Template palette (border-neutral / emerald / amber / pink), extended with
// blue + rose the same way QueueClient extended it for job states.
const STATUS_TONE: Record<Status, string> = {
  draft: "border text-muted-foreground bg-transparent",
  pending:
    "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 border-blue-200 dark:border-blue-900",
  active:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900",
  paused:
    "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-amber-200 dark:border-amber-900",
  ended:
    "bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-400 border-pink-200 dark:border-pink-900",
  failed:
    "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400 border-rose-200 dark:border-rose-900",
};

export function AdStatusBadge({ status }: { status: string }) {
  const s = (STATUSES as string[]).includes(status) ? (status as Status) : null;
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-xs font-medium px-2 py-0.5",
        s ? STATUS_TONE[s] : "border text-muted-foreground bg-transparent",
      )}
    >
      {s ? STATUS_LABEL[s] : status}
    </Badge>
  );
}

function SortableHeader({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      className="h-auto p-0 font-medium text-xs hover:bg-transparent"
      onClick={onClick}
    >
      {label} <ChevronsUpDown className="ml-1 size-3" />
    </Button>
  );
}

export function CampaignsClient({
  initial,
  accounts,
  hasAccounts,
}: {
  initial: AdCampaign[];
  /** Real accounts list — used only to resolve a real account label per row. */
  accounts: AdAccount[];
  hasAccounts: boolean;
}) {
  const { data } = useSWR<AdCampaign[]>(adsKeys.campaigns(), clientFetch, {
    fallbackData: initial,
    refreshInterval: 30_000,
  });
  const campaigns = data ?? [];

  const accountLabel = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of accounts) {
      map[a.id] = a.name || a.external_account_id || a.platform.replace("_", " ");
    }
    return map;
  }, [accounts]);

  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [rowSelection, setRowSelection] = React.useState({});
  const [searchQuery, setSearchQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<Status | "all">("all");

  const columns = React.useMemo<ColumnDef<AdCampaign>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && "indeterminate")
            }
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        accessorKey: "name",
        header: ({ column }) => (
          <SortableHeader
            label="Campaign name"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <Link
            href={`/ads/campaigns/${row.original.id}`}
            className="text-sm font-medium truncate hover:underline min-w-[160px] inline-block align-middle"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => (
          <SortableHeader
            label="Status"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => <AdStatusBadge status={row.original.status} />,
      },
      {
        id: "account",
        accessorFn: (c) => accountLabel[c.ad_account_id] ?? "",
        header: ({ column }) => (
          <SortableHeader
            label="Account"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground capitalize truncate max-w-[180px] inline-block align-middle">
            {accountLabel[row.original.ad_account_id] ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "daily_budget_usd",
        header: ({ column }) => (
          <SortableHeader
            label="Daily budget"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground font-mono tabular-nums">
            {row.original.daily_budget_usd
              ? formatUsd(row.original.daily_budget_usd)
              : "—"}
          </span>
        ),
      },
      {
        accessorKey: "objective",
        header: ({ column }) => (
          <SortableHeader
            label="Objective"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground capitalize max-w-[200px] truncate inline-block align-middle">
            {row.original.objective || "—"}
          </span>
        ),
      },
    ],
    [accountLabel],
  );

  const filteredData = React.useMemo(() => {
    let result = campaigns;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((c) => c.name.toLowerCase().includes(q));
    }
    if (statusFilter !== "all") {
      result = result.filter((c) => c.status === statusFilter);
    }
    return result;
  }, [campaigns, searchQuery, statusFilter]);

  const table = useReactTable({
    data: filteredData,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 8 } },
  });

  const hasActiveFilters = statusFilter !== "all";
  const pageSize = table.getState().pagination.pageSize;
  const pageIndex = table.getState().pagination.pageIndex;
  const totalRows = filteredData.length;
  const from = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min((pageIndex + 1) * pageSize, totalRows);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
        <p className="text-sm text-muted-foreground">
          Draft, launch, and scale campaigns. Budgets and activation pass the
          spend guard before anything goes live.
        </p>
      </div>

      {!hasAccounts ? (
        <EmptyNoAccounts />
      ) : (
        <div className="rounded-lg border bg-card flex flex-col">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-4 border-b">
            <div className="relative flex-1 w-full sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                placeholder="Search campaigns..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-8 text-sm"
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                    <Filter className="size-3" />
                    Filter
                    {hasActiveFilters && <span className="size-1.5 rounded-full bg-primary" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  <DropdownMenuCheckboxItem
                    checked={statusFilter === "all"}
                    onCheckedChange={() => setStatusFilter("all")}
                  >
                    All statuses
                  </DropdownMenuCheckboxItem>
                  {STATUSES.map((s) => (
                    <DropdownMenuCheckboxItem
                      key={s}
                      checked={statusFilter === s}
                      onCheckedChange={() => setStatusFilter(s)}
                    >
                      {STATUS_LABEL[s]}
                    </DropdownMenuCheckboxItem>
                  ))}
                  {statusFilter !== "all" && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setStatusFilter("all")}>
                        Clear filter
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <Button size="sm" className="h-8 gap-1.5 ml-auto" asChild>
              <Link href="/ads/campaigns/new">
                <Plus className="size-3.5" />
                <span className="hidden sm:inline">New campaign</span>
              </Link>
            </Button>
          </div>

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
                {table.getRowModel().rows.length ? (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      className="border-b last:border-0 hover:bg-muted/30"
                      data-state={row.getIsSelected() && "selected"}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className="py-3 whitespace-nowrap">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                      No campaigns found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-4 py-3 border-t">
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>
                {totalRows === 0
                  ? "0 campaigns"
                  : `Showing ${from} to ${to} of ${totalRows} campaigns`}
              </span>
              <div className="flex items-center gap-2">
                <span className="hidden sm:inline">Rows per page</span>
                <Select value={String(pageSize)} onValueChange={(v) => table.setPageSize(Number(v))}>
                  <SelectTrigger className="h-8 w-[70px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5</SelectItem>
                    <SelectItem value="8">8</SelectItem>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="20">20</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="size-8" onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}>
                <ChevronsLeft className="size-4" />
              </Button>
              <Button variant="outline" size="icon" className="size-8" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
                <ChevronLeft className="size-4" />
              </Button>
              <span className="px-2 text-sm tabular-nums">
                {pageIndex + 1} / {table.getPageCount() || 1}
              </span>
              <Button variant="outline" size="icon" className="size-8" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
                <ChevronRight className="size-4" />
              </Button>
              <Button variant="outline" size="icon" className="size-8" onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()}>
                <ChevronsRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyNoAccounts() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <h3 className="text-lg font-semibold">Connect an account first</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          Link Google Ads or Meta Ads before creating campaigns.
        </p>
        <Button asChild>
          <Link href="/ads/connect">Connect an account</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
