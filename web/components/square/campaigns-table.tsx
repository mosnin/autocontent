"use client";

// Square UI "marketing-dashboard" template campaigns-table, ported
// verbatim — TanStack table wiring, sortable headers, row selection,
// toolbar (search + filter), and the full pagination footer. Adaptations
// are real-data mapping only:
//   - mock `campaigns` become the `campaigns` prop (our real Campaign
//     type); columns map to real fields: name, status, budget, ends,
//     objective. Template columns with no real counterpart (platforms,
//     pay rate, creators, submissions, paid, percentage) are dropped
//     rather than faked.
//   - statuses are ours (draft/running/paused/completed) rendered with the
//     template's exact badge palette (Draft/Live/Paused/Ended slots);
//   - the template's zustand store becomes local state (same behavior);
//   - the platform "Sort" dropdown is dropped (no platform field on
//     Campaign);
//   - campaign names link to the real campaign detail page and the
//     New-campaign button triggers the page's real create form.

import { useMemo, useState } from "react";
import Link from "next/link";
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
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/square/ui/avatar";
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
import type { Campaign, CampaignStatus } from "@/lib/types";

const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "Draft",
  running: "Running",
  paused: "Paused",
  completed: "Completed",
};

function StatusBadge({ status }: { status: CampaignStatus }) {
  // Template palette: Draft / Live / Paused / Ended slots mapped onto our
  // real statuses.
  const variants: Record<CampaignStatus, string> = {
    draft: "border text-muted-foreground bg-transparent",
    running:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900",
    paused:
      "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-amber-200 dark:border-amber-900",
    completed:
      "bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-400 border-pink-200 dark:border-pink-900",
  };
  return (
    <Badge
      variant="outline"
      className={cn("text-xs font-medium px-2 py-0.5", variants[status])}
    >
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function CampaignsTable({
  campaigns,
  onNewCampaign,
}: {
  campaigns: Campaign[];
  /** Real action for the toolbar's New-campaign button. */
  onNewCampaign?: () => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState({});
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | "all">(
    "all"
  );

  const columns = useMemo<ColumnDef<Campaign>[]>(
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
          <Button variant="ghost" className="h-auto p-0 font-medium text-xs hover:bg-transparent" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Campaign name <ChevronsUpDown className="ml-1 size-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <div className="flex items-center gap-2 min-w-[160px]">
            <Avatar className="size-6 shrink-0">
              <AvatarImage src={`https://api.dicebear.com/9.x/glass/svg?seed=${row.original.id}`} />
              <AvatarFallback className="text-xs">{row.original.name[0]}</AvatarFallback>
            </Avatar>
            <Link
              href={`/campaigns/${row.original.id}`}
              className="text-sm font-medium truncate hover:underline"
            >
              {row.original.name}
            </Link>
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => (
          <Button variant="ghost" className="h-auto p-0 font-medium text-xs hover:bg-transparent" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Status <ChevronsUpDown className="ml-1 size-3" />
          </Button>
        ),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "budget_usd",
        header: ({ column }) => (
          <Button variant="ghost" className="h-auto p-0 font-medium text-xs hover:bg-transparent" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Budget <ChevronsUpDown className="ml-1 size-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {`$${Number(row.original.budget_usd).toLocaleString()}`}
          </span>
        ),
      },
      {
        accessorKey: "ends_at",
        header: ({ column }) => (
          <Button variant="ghost" className="h-auto p-0 font-medium text-xs hover:bg-transparent" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Ends <ChevronsUpDown className="ml-1 size-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.ends_at
              ? new Date(row.original.ends_at).toLocaleDateString()
              : "—"}
          </span>
        ),
      },
      {
        accessorKey: "objective",
        header: ({ column }) => (
          <Button variant="ghost" className="h-auto p-0 font-medium text-xs hover:bg-transparent" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Objective <ChevronsUpDown className="ml-1 size-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground max-w-[280px] truncate inline-block align-middle">
            {row.original.objective || "—"}
          </span>
        ),
      },
    ],
    []
  );

  const filteredData = useMemo(() => {
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
              <DropdownMenuCheckboxItem checked={statusFilter === "all"} onCheckedChange={() => setStatusFilter("all")}>
                All statuses
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={statusFilter === "draft"} onCheckedChange={() => setStatusFilter("draft")}>
                Draft
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={statusFilter === "running"} onCheckedChange={() => setStatusFilter("running")}>
                Running
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={statusFilter === "paused"} onCheckedChange={() => setStatusFilter("paused")}>
                Paused
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={statusFilter === "completed"} onCheckedChange={() => setStatusFilter("completed")}>
                Completed
              </DropdownMenuCheckboxItem>
              {statusFilter !== "all" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setStatusFilter("all")}>Clear filter</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Button size="sm" className="h-8 gap-1.5 ml-auto" onClick={onNewCampaign}>
          <Plus className="size-3.5" />
          <span className="hidden sm:inline">New campaign</span>
        </Button>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="text-xs font-medium text-muted-foreground h-10 whitespace-nowrap">
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="border-b last:border-0 hover:bg-muted/30" data-state={row.getIsSelected() && "selected"}>
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
  );
}
