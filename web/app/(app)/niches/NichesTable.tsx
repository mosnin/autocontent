"use client";

// Square UI "marketing-dashboard" template campaigns-table, ported
// verbatim for the Niches list — same TanStack table wiring, sortable
// headers, row selection, toolbar (search + filter), and pagination
// footer as components/square/campaigns-table.tsx. Adaptations are real
// data mapping only:
//   - mock `campaigns` become the `niches` prop (our real Niche type);
//     columns map to real fields: title, status (archived_at), daily
//     spend cap, created date, character description. Template columns
//     with no real counterpart (pay rate, creators, submissions, paid,
//     percentage) are dropped rather than faked.
//   - the template's Draft/Live/Paused/Ended status badge slots become
//     ours (Active / Archived) rendered with the same badge chrome;
//   - the template's status "Filter" dropdown becomes a filter over
//     Active/Archived (the real analogous field);
//   - niche titles link to the real niche detail page and the primary
//     toolbar action ("Create niche") routes to /onboarding, our real
//     creation flow, instead of calling a local callback.

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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/square/ui/avatar";
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
import { formatUsd } from "@/lib/format";
import type { Niche, Platform } from "@/lib/types";

const PLATFORM_LABEL: Record<Platform, string> = {
  tiktok: "TikTok",
  reels: "Reels",
  shorts: "Shorts",
};

type NicheStatus = "active" | "archived";

function nicheStatus(n: Niche): NicheStatus {
  return n.archived_at ? "archived" : "active";
}

function StatusBadge({ status }: { status: NicheStatus }) {
  // Template palette: Draft/Live/Paused/Ended slots mapped onto our real
  // active/archived states.
  const variants: Record<NicheStatus, string> = {
    active:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900",
    archived: "border text-muted-foreground bg-transparent",
  };
  return (
    <Badge
      variant="outline"
      className={cn("text-xs font-medium px-2 py-0.5", variants[status])}
    >
      {status === "active" ? "Active" : "Archived"}
    </Badge>
  );
}

export function NichesTable({ niches }: { niches: Niche[] }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState({});
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<NicheStatus | "all">("all");

  const columns = useMemo<ColumnDef<Niche>[]>(
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
        accessorKey: "title",
        header: ({ column }) => (
          <Button variant="ghost" className="h-auto p-0 font-medium text-xs hover:bg-transparent" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Niche <ChevronsUpDown className="ml-1 size-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <div className="flex items-center gap-2 min-w-[160px]">
            <Avatar className="size-6 shrink-0">
              <AvatarImage src={`https://api.dicebear.com/9.x/glass/svg?seed=${row.original.id}`} />
              <AvatarFallback className="text-xs">{row.original.title[0]}</AvatarFallback>
            </Avatar>
            <Link
              href={`/niches/${row.original.id}`}
              className="text-sm font-medium truncate hover:underline"
            >
              {row.original.title}
            </Link>
          </div>
        ),
      },
      {
        id: "status",
        accessorFn: (n) => nicheStatus(n),
        header: ({ column }) => (
          <Button variant="ghost" className="h-auto p-0 font-medium text-xs hover:bg-transparent" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Status <ChevronsUpDown className="ml-1 size-3" />
          </Button>
        ),
        cell: ({ row }) => <StatusBadge status={nicheStatus(row.original)} />,
      },
      {
        id: "platforms",
        header: () => (
          <span className="font-medium text-xs">Platforms</span>
        ),
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.platforms.length > 0 ? (
              row.original.platforms.map((p) => (
                <Badge key={p} variant="secondary" className="text-xs font-normal px-1.5 py-0">
                  {PLATFORM_LABEL[p]}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </div>
        ),
        enableSorting: false,
      },
      {
        accessorKey: "daily_spend_cap_usd",
        header: ({ column }) => (
          <Button variant="ghost" className="h-auto p-0 font-medium text-xs hover:bg-transparent" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Daily cap <ChevronsUpDown className="ml-1 size-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatUsd(row.original.daily_spend_cap_usd)}
          </span>
        ),
      },
      {
        accessorKey: "created_at",
        header: ({ column }) => (
          <Button variant="ghost" className="h-auto p-0 font-medium text-xs hover:bg-transparent" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Created <ChevronsUpDown className="ml-1 size-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.created_at
              ? new Date(row.original.created_at).toLocaleDateString()
              : "—"}
          </span>
        ),
      },
      {
        accessorKey: "character_description",
        header: ({ column }) => (
          <Button variant="ghost" className="h-auto p-0 font-medium text-xs hover:bg-transparent" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Character <ChevronsUpDown className="ml-1 size-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground max-w-[240px] truncate inline-block align-middle">
            {row.original.character_description || "—"}
          </span>
        ),
      },
    ],
    []
  );

  const filteredData = useMemo(() => {
    let result = niches;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((n) => n.title.toLowerCase().includes(q));
    }
    if (statusFilter !== "all") {
      result = result.filter((n) => nicheStatus(n) === statusFilter);
    }
    return result;
  }, [niches, searchQuery, statusFilter]);

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
            placeholder="Search niches..."
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
              <DropdownMenuCheckboxItem checked={statusFilter === "active"} onCheckedChange={() => setStatusFilter("active")}>
                Active
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={statusFilter === "archived"} onCheckedChange={() => setStatusFilter("archived")}>
                Archived
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
        <Button size="sm" className="h-8 gap-1.5 ml-auto" asChild>
          <Link href="/onboarding">
            <Plus className="size-3.5" />
            <span className="hidden sm:inline">Create niche</span>
          </Link>
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
                  No niches found.
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
              ? "0 niches"
              : `Showing ${from} to ${to} of ${totalRows} niches`}
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
