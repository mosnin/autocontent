"use client";

// Square UI "marketing-dashboard" template campaigns-table, ported to the
// calendar agenda — same TanStack table anatomy (toolbar with search +
// filter dropdown, sortable headers, row-selection checkbox column,
// template badge palette, full pagination footer) as
// components/square/campaigns-table.tsx. Adaptations are real-data
// mapping + our routes only:
//   - mock `campaigns` become the polled `items` (real CalendarItem[]);
//     columns map to real fields: date/time (item.at), niche (resolved
//     via the server-fetched niche id -> title map, mirroring
//     queue/QueueClient.tsx — real title or "—" if unknown), platform
//     (existing platform logos kept, "—" for kinds with no platform),
//     type (video/article/ad), status (mapped onto the template's badge
//     tones across all three kinds' real status enums).
//   - the template's status "Filter" dropdown becomes the real look-ahead
//     range picker (7/30/90 days) — same range state, same SWR key/fetch,
//     same fallbackData/keepPreviousData behavior as before.
//   - the template's zustand store becomes local state (same technique as
//     campaigns-table.tsx / QueueClient.tsx).
//   - rows link to the same real destinations AgendaList used
//     (/queue/[id], /articles/[id], /ads/campaigns/[id]).
//   - template columns with no real counterpart (avatar image, budget,
//     ends, objective, New-campaign action) are dropped rather than
//     faked — the calendar has no creation entry point of its own.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { Instagram, Music2, Youtube } from "lucide-react";
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
import { DashHeading } from "@/components/hub/dashboard-kit";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  articleStatusLabel,
  ARTICLE_IN_PROGRESS,
  jobStatusLabel,
} from "@/lib/status-badge";
import {
  calendarKey,
  CALENDAR_RANGES,
  DEFAULT_CALENDAR_RANGE,
  type CalendarItem,
  type CalendarRange,
} from "@/components/calendar/types";
import { clientFetch } from "@/lib/client-fetcher";
import type { ArticleStatus, JobStatus } from "@/lib/types";

// Posting windows move slowly; a 60s refresh keeps the agenda fresh
// without the aggressive polling the live pipeline views use.
const POLL_MS = 60_000;

const RANGE_LABEL: Record<CalendarRange, string> = {
  7: "Next 7 days",
  30: "Next 30 days",
  90: "Next 90 days",
};

const JOB_IN_PROGRESS = new Set<JobStatus>([
  "ideating",
  "scripting",
  "generating_images",
  "animating",
  "voicing",
  "editing",
  "captioning",
  "qa",
  "scheduling",
]);

const KIND_LABEL: Record<CalendarItem["kind"], string> = {
  video: "Video",
  article: "Article",
  ad: "Ad",
};

const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  reels: "Reels",
  shorts: "Shorts",
};

function PlatformIcon({ platform }: { platform: string }) {
  const cls = "size-3.5 text-muted-foreground";
  if (platform === "tiktok") return <Music2 className={cls} />;
  if (platform === "reels") return <Instagram className={cls} />;
  if (platform === "shorts") return <Youtube className={cls} />;
  return null;
}

function itemHref(item: CalendarItem): string {
  if (item.kind === "video") return `/queue/${item.id}`;
  if (item.kind === "ad") return `/ads/campaigns/${item.id}`;
  return `/articles/${item.id}`;
}

function statusText(item: CalendarItem): string {
  if (item.kind === "video") return jobStatusLabel(item.status as JobStatus);
  if (item.kind === "ad") return item.status;
  return articleStatusLabel(item.status as ArticleStatus);
}

// Template badge palette (border-neutral / blue / amber / emerald / rose)
// extended across all three real kinds' status enums, same technique as
// campaigns-table.tsx / QueueClient.tsx.
function StatusBadge({ item }: { item: CalendarItem }) {
  const label = statusText(item);
  let tone =
    "border text-muted-foreground bg-transparent"; // queued / skipped / default

  if (item.kind === "video") {
    const s = item.status as JobStatus;
    if (s === "done") tone = "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900";
    else if (s === "failed") tone = "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400 border-rose-200 dark:border-rose-900";
    else if (s === "awaiting_approval") tone = "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-amber-200 dark:border-amber-900";
    else if (JOB_IN_PROGRESS.has(s)) tone = "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 border-blue-200 dark:border-blue-900";
  } else if (item.kind === "article") {
    const s = item.status as ArticleStatus;
    if (s === "done") tone = "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900";
    else if (s === "failed") tone = "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400 border-rose-200 dark:border-rose-900";
    else if (ARTICLE_IN_PROGRESS.has(s)) tone = "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 border-blue-200 dark:border-blue-900";
  } else {
    // ad: raw backend status string, no enum on the client — bucket by
    // keyword the same way the other kinds bucket their real enums.
    const s = item.status.toLowerCase();
    if (s.includes("fail")) tone = "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400 border-rose-200 dark:border-rose-900";
    else if (s === "done" || s === "completed" || s === "live" || s === "running") tone = "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900";
    else if (s !== "queued" && s !== "paused" && s !== "skipped") tone = "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 border-blue-200 dark:border-blue-900";
  }

  return (
    <Badge variant="outline" className={cn("text-xs font-medium px-2 py-0.5", tone)}>
      {label}
    </Badge>
  );
}

function SortableHeader({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" className="h-auto p-0 font-medium text-xs hover:bg-transparent" onClick={onClick}>
      {label} <ChevronsUpDown className="ml-1 size-3" />
    </Button>
  );
}

export function CalendarClient({
  initial,
  nicheTitles,
}: {
  initial: CalendarItem[];
  /** niche_id -> title, resolved server-side from the real niches list
   *  (same technique as queue/QueueClient.tsx). */
  nicheTitles: Record<string, string>;
}) {
  const router = useRouter();
  const [range, setRange] = React.useState<CalendarRange>(
    DEFAULT_CALENDAR_RANGE,
  );
  // True from the moment the user picks a new range until its data arrives.
  // keepPreviousData means the old agenda stays on screen, so without this the
  // switch would feel unresponsive on a slow fetch.
  const [switching, setSwitching] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [rowSelection, setRowSelection] = React.useState({});

  const { data, error } = useSWR<CalendarItem[]>(
    calendarKey(range),
    clientFetch,
    {
      refreshInterval: POLL_MS,
      // fallbackData only matches the default window's key; switching
      // range fetches fresh (keepPreviousData avoids a content flash).
      fallbackData: range === DEFAULT_CALENDAR_RANGE ? initial : undefined,
      keepPreviousData: true,
    },
  );

  // Clear the pending flag once fresh data lands (a background poll clearing an
  // already-false flag is a harmless no-op).
  React.useEffect(() => {
    setSwitching(false);
  }, [data]);

  function onRangeChange(next: CalendarRange) {
    if (next === range) return;
    setSwitching(true);
    setRange(next);
  }

  // Toast only the first error in a sequence, not every poll failure.
  const errorToastedRef = React.useRef(false);
  React.useEffect(() => {
    if (error && !errorToastedRef.current) {
      errorToastedRef.current = true;
      toast.error(`Live updates paused: ${error.message ?? "fetch failed"}`);
    }
    if (!error) {
      errorToastedRef.current = false;
    }
  }, [error]);

  const items = data ?? [];

  const columns = React.useMemo<ColumnDef<CalendarItem>[]>(
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
            onClick={(e) => e.stopPropagation()}
          />
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        id: "at",
        accessorFn: (item) => new Date(item.at).getTime(),
        header: ({ column }) => (
          <SortableHeader label="Date & time" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")} />
        ),
        cell: ({ row }) => (
          <div className="flex flex-col min-w-[160px]">
            <Link
              href={itemHref(row.original)}
              className="text-sm font-medium truncate hover:underline"
            >
              {row.original.title}
            </Link>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {new Date(row.original.at).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          </div>
        ),
      },
      {
        id: "niche",
        accessorFn: (item) => nicheTitles[item.niche_id] ?? "",
        header: ({ column }) => (
          <SortableHeader label="Niche" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")} />
        ),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground truncate max-w-[200px] inline-block align-middle">
            {nicheTitles[row.original.niche_id] ?? "—"}
          </span>
        ),
      },
      {
        id: "platform",
        accessorFn: (item) => item.platform ?? "",
        header: ({ column }) => (
          <SortableHeader label="Platform" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")} />
        ),
        cell: ({ row }) => {
          const platform = row.original.platform;
          if (!platform) return <span className="text-sm text-muted-foreground">—</span>;
          return (
            <span className="flex items-center gap-1.5 text-sm">
              <PlatformIcon platform={platform} />
              {PLATFORM_LABEL[platform] ?? platform}
            </span>
          );
        },
      },
      {
        id: "kind",
        accessorFn: (item) => KIND_LABEL[item.kind],
        header: ({ column }) => (
          <SortableHeader label="Type" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")} />
        ),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{KIND_LABEL[row.original.kind]}</span>
        ),
      },
      {
        id: "status",
        accessorFn: (item) => statusText(item),
        header: ({ column }) => (
          <SortableHeader label="Status" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")} />
        ),
        cell: ({ row }) => <StatusBadge item={row.original} />,
      },
    ],
    [nicheTitles],
  );

  const filteredData = React.useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter((i) => {
      const niche = (nicheTitles[i.niche_id] ?? "").toLowerCase();
      return i.title.toLowerCase().includes(q) || niche.includes(q);
    });
  }, [items, searchQuery, nicheTitles]);

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
    initialState: { pagination: { pageSize: 10 } },
  });

  const hasActiveFilters = range !== DEFAULT_CALENDAR_RANGE;
  const pageSize = table.getState().pagination.pageSize;
  const pageIndex = table.getState().pagination.pageIndex;
  const totalRows = filteredData.length;
  const from = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min((pageIndex + 1) * pageSize, totalRows);

  return (
    <div className="space-y-6">
      <DashHeading
        as="h1"
        sub={`Every scheduled post, next ${range} days. Updates every ${POLL_MS / 1000}s.`}
      >
        Calendar
      </DashHeading>

      {error && (
        <p className="text-sm text-muted-foreground">
          Live updates paused — {error.message ?? "fetch failed"}
        </p>
      )}

      <div
        className={cn("rounded-lg border bg-card flex flex-col transition-opacity", switching && "pointer-events-none opacity-60")}
        aria-busy={switching}
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-4 border-b">
          <div className="relative flex-1 w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search scheduled posts..."
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
                {CALENDAR_RANGES.map((r) => (
                  <DropdownMenuCheckboxItem
                    key={r}
                    checked={range === r}
                    onCheckedChange={() => onRangeChange(r)}
                  >
                    {RANGE_LABEL[r]}
                  </DropdownMenuCheckboxItem>
                ))}
                {hasActiveFilters && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onRangeChange(DEFAULT_CALENDAR_RANGE)}>
                      Clear filter
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {switching && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
                <Spinner className="size-3.5" aria-hidden />
                Updating…
              </span>
            )}
          </div>
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
                  <TableRow
                    key={row.id}
                    className="border-b last:border-0 hover:bg-muted/30 cursor-pointer"
                    data-state={row.getIsSelected() && "selected"}
                    onClick={() => router.push(itemHref(row.original))}
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
                    {searchQuery
                      ? "No scheduled posts match this search."
                      : `Nothing scheduled in the next ${range} days.`}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-4 py-3 border-t">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>
              {totalRows === 0 ? "0 scheduled posts" : `Showing ${from} to ${to} of ${totalRows} scheduled posts`}
            </span>
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline">Rows per page</span>
              <Select value={String(pageSize)} onValueChange={(v) => table.setPageSize(Number(v))}>
                <SelectTrigger className="h-8 w-[70px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
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
    </div>
  );
}
