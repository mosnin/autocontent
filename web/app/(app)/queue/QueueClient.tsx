"use client";

// Square UI "marketing-dashboard" template campaigns-table, ported to the
// queue job list — same TanStack table anatomy (toolbar with search +
// filter dropdown + primary action, sortable headers, row-selection
// checkbox column, template badge palette, full pagination footer) as
// components/square/campaigns-table.tsx. Adaptations are real-data
// mapping + our routes only:
//   - mock `campaigns` become the `initial`/polled `jobs` prop (real Job
//     type); columns map to real fields: hook/topic, niche (resolved via
//     the server-fetched niche id -> title map — real title or "—" if
//     unknown), platform (existing platform logos kept), status
//     (mapped onto the template's badge tones), created (relative time,
//     same helper QueueClient always used).
//   - the template's single "status" filter dropdown replaces the old
//     Tabs — same Filter type and `matches()` logic, just new chrome,
//     so the awaiting/in-progress/done/failed semantics are unchanged.
//   - the template's zustand store becomes local state (same behavior
//     as campaigns-table.tsx).
//   - retry/approve/reject stay as real row actions (SWR optimistic
///    update + server actions), rendered in an actions column since the
//     template has no equivalent (campaigns has no per-row actions).
//   - the template's "New campaign" button becomes "New job", which
//     opens the existing command palette (⌘K) — the only real job
//     creation entry point already wired into the app.
//   - template columns with no real counterpart for jobs (avatar image,
//     budget, ends, objective) are dropped rather than faked.

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
import { openCommandPalette } from "@/components/command-palette";
import {
  approveJobAction,
  rejectJobAction,
  retryJobAction,
} from "@/lib/actions";
import { clientFetch } from "@/lib/client-fetcher";
import { jobStatusLabel } from "@/lib/status-badge";
import type { Job, JobStatus } from "@/lib/types";

const POLL_MS = 5000;

const IN_PROGRESS = new Set<JobStatus>([
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

type Filter = "all" | "awaiting" | "in_progress" | "done" | "failed";

const FILTERS: Filter[] = ["all", "awaiting", "in_progress", "done", "failed"];

const FILTER_LABEL: Record<Filter, string> = {
  all: "All statuses",
  awaiting: "Needs approval",
  in_progress: "In progress",
  done: "Done",
  failed: "Failed",
};

function matches(job: Job, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "awaiting") return job.status === "awaiting_approval";
  if (filter === "done") return job.status === "done";
  if (filter === "failed") return job.status === "failed";
  if (filter === "in_progress")
    return job.status === "queued" || IN_PROGRESS.has(job.status);
  return true;
}

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

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

// Template badge palette (border-neutral / emerald / amber / pink) extended
// with two extra tones (blue, rose) since Job has more real states than
// Campaign does. Same technique as campaigns-table.tsx: Badge
// variant="outline" plus a tonal bg/text/border class per status.
function StatusBadge({ status }: { status: JobStatus }) {
  if (status === "queued" || status === "skipped") {
    return (
      <Badge variant="outline" className="text-xs font-medium px-2 py-0.5 border text-muted-foreground bg-transparent">
        {jobStatusLabel(status)}
      </Badge>
    );
  }
  if (IN_PROGRESS.has(status)) {
    return (
      <Badge
        variant="outline"
        className="text-xs font-medium px-2 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 border-blue-200 dark:border-blue-900"
      >
        {jobStatusLabel(status)}
      </Badge>
    );
  }
  if (status === "awaiting_approval") {
    return (
      <Badge
        variant="outline"
        className="text-xs font-medium px-2 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-amber-200 dark:border-amber-900"
      >
        Needs approval
      </Badge>
    );
  }
  if (status === "done") {
    return (
      <Badge
        variant="outline"
        className="text-xs font-medium px-2 py-0.5 bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900"
      >
        Done
      </Badge>
    );
  }
  // failed
  return (
    <Badge
      variant="outline"
      className="text-xs font-medium px-2 py-0.5 bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400 border-rose-200 dark:border-rose-900"
    >
      Failed
    </Badge>
  );
}

function SortableHeader({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
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

export function QueueClient({
  initial,
  nicheTitles,
}: {
  initial: Job[];
  /** niche_id -> title, resolved server-side from the real niches list. */
  nicheTitles: Record<string, string>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Deep links (e.g. the dashboard payoff banner's ?status_filter=done)
  // land on the right filter instead of silently resetting to "all".
  const requested = searchParams.get("status_filter");
  const [filter, setFilter] = React.useState<Filter>(
    FILTERS.includes(requested as Filter) ? (requested as Filter) : "all",
  );
  const [searchQuery, setSearchQuery] = React.useState("");
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [rowSelection, setRowSelection] = React.useState({});

  const { data, error, mutate } = useSWR<Job[]>(
    "/api/v1/jobs?limit=100",
    clientFetch,
    {
      refreshInterval: POLL_MS,
      fallbackData: initial,
    },
  );

  // Only toast the first error in a sequence, not every poll failure.
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

  const jobs = data ?? [];

  const counts = React.useMemo(
    () => ({
      all: jobs.length,
      awaiting: jobs.filter((j) => matches(j, "awaiting")).length,
      in_progress: jobs.filter((j) => matches(j, "in_progress")).length,
      done: jobs.filter((j) => matches(j, "done")).length,
      failed: jobs.filter((j) => matches(j, "failed")).length,
    }),
    [jobs],
  );

  async function handleRetry(job: Job) {
    const prevJobs = jobs;

    // Optimistically move the job from "failed" to "queued".
    const optimisticJobs = jobs.map((j) =>
      j.id === job.id ? { ...j, status: "queued" as JobStatus } : j,
    );
    void mutate(optimisticJobs, false);

    const fd = new FormData();
    fd.set("job_id", job.id);
    const res = await retryJobAction({ ok: false }, fd);

    if (res.ok) {
      toast.success("Retry enqueued");
      // Revalidate to get the real server state.
      void mutate();
    } else {
      // Revert optimistic update.
      void mutate(prevJobs, false);
      toast.error(res.error ?? "Retry failed");
    }
  }

  async function handleApprove(job: Job) {
    const fd = new FormData();
    fd.set("job_id", job.id);
    const res = await approveJobAction({ ok: false }, fd);
    if (res.ok) {
      toast.success("Approved — scheduling the post now");
      void mutate();
    } else {
      toast.error(res.error ?? "Approve failed");
    }
  }

  async function handleReject(job: Job) {
    if (!confirm("Reject this video? It will never post.")) return;
    const fd = new FormData();
    fd.set("job_id", job.id);
    const res = await rejectJobAction({ ok: false }, fd);
    if (res.ok) {
      toast.success("Rejected — it will not post");
      void mutate();
    } else {
      toast.error(res.error ?? "Reject failed");
    }
  }

  const columns = React.useMemo<ColumnDef<Job>[]>(
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
        id: "hook",
        accessorFn: (job) => job.script?.idea?.hook ?? job.script?.idea?.topic ?? "",
        header: ({ column }) => (
          <SortableHeader
            label="Job"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => {
          const job = row.original;
          const hook = job.script?.idea?.hook;
          return (
            <div className="flex flex-col min-w-[200px] max-w-[360px]">
              <Link
                href={`/queue/${job.id}`}
                className="text-sm font-medium truncate hover:underline"
              >
                {hook ? `"${hook}"` : `Job ${job.id.slice(0, 8)}`}
              </Link>
              <code className="font-mono text-xs text-muted-foreground">
                {job.id.slice(0, 8)}
              </code>
            </div>
          );
        },
      },
      {
        id: "niche",
        accessorFn: (job) => nicheTitles[job.niche_id] ?? "",
        header: ({ column }) => (
          <SortableHeader
            label="Niche"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground truncate max-w-[200px] inline-block align-middle">
            {nicheTitles[row.original.niche_id] ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "platform",
        header: ({ column }) => (
          <SortableHeader
            label="Platform"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5 text-sm">
            <PlatformIcon platform={row.original.platform} />
            {PLATFORM_LABEL[row.original.platform] ?? row.original.platform}
          </span>
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
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "created_at",
        header: ({ column }) => (
          <SortableHeader
            label="Created"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground tabular-nums">
            {relative(row.original.created_at)}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => <span className="text-xs font-medium text-muted-foreground">Actions</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions
            job={row.original}
            onRetry={handleRetry}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nicheTitles],
  );

  const filteredData = React.useMemo(() => {
    let result = jobs.filter((j) => matches(j, filter));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((j) => {
        const hook = j.script?.idea?.hook?.toLowerCase() ?? "";
        const topic = j.script?.idea?.topic?.toLowerCase() ?? "";
        const niche = (nicheTitles[j.niche_id] ?? "").toLowerCase();
        return (
          hook.includes(q) ||
          topic.includes(q) ||
          niche.includes(q) ||
          j.id.toLowerCase().includes(q)
        );
      });
    }
    return result;
  }, [jobs, filter, searchQuery, nicheTitles]);

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

  const hasActiveFilters = filter !== "all";
  const pageSize = table.getState().pagination.pageSize;
  const pageIndex = table.getState().pagination.pageIndex;
  const totalRows = filteredData.length;
  const from = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min((pageIndex + 1) * pageSize, totalRows);

  return (
    <div className="space-y-6">
      <DashHeading as="h1" sub={`All pipeline runs. Updates every ${POLL_MS / 1000}s.`}>
        Queue
      </DashHeading>

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
              placeholder="Search jobs..."
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
              <DropdownMenuContent align="start" className="w-56">
                {FILTERS.map((f) => (
                  <DropdownMenuCheckboxItem
                    key={f}
                    checked={filter === f}
                    onCheckedChange={() => setFilter(f)}
                  >
                    {FILTER_LABEL[f]}
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                      {counts[f]}
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
                {filter !== "all" && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setFilter("all")}>Clear filter</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Button
            size="sm"
            className="h-8 gap-1.5 ml-auto"
            onClick={() => openCommandPalette()}
          >
            <span className="hidden sm:inline">New job</span>
            <span className="sm:hidden">New</span>
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
                    className="border-b last:border-0 hover:bg-muted/30 cursor-pointer"
                    data-state={row.getIsSelected() && "selected"}
                    onClick={() => router.push(`/queue/${row.original.id}`)}
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
                    {filter === "all" && !searchQuery
                      ? "No jobs yet. Trigger one from the dashboard or via the command palette (⌘K)."
                      : "No jobs match this filter."}
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
                ? "0 jobs"
                : `Showing ${from} to ${to} of ${totalRows} jobs`}
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

function RowActions({
  job,
  onRetry,
  onApprove,
  onReject,
}: {
  job: Job;
  onRetry: (job: Job) => Promise<void>;
  onApprove: (job: Job) => Promise<void>;
  onReject: (job: Job) => Promise<void>;
}) {
  const [retrying, setRetrying] = React.useState(false);
  const [acting, setActing] = React.useState(false);

  async function handleApproveClick(e: React.MouseEvent) {
    e.stopPropagation();
    setActing(true);
    await onApprove(job);
    setActing(false);
  }

  async function handleRejectClick(e: React.MouseEvent) {
    e.stopPropagation();
    setActing(true);
    await onReject(job);
    setActing(false);
  }

  async function handleRetryClick(e: React.MouseEvent) {
    e.stopPropagation();
    setRetrying(true);
    await onRetry(job);
    setRetrying(false);
  }

  if (job.status === "failed") {
    return (
      <Button
        size="sm"
        variant="destructive"
        className="h-7 text-xs"
        onClick={handleRetryClick}
        disabled={retrying}
        aria-label={`Retry job ${job.id.slice(0, 8)}`}
      >
        {retrying ? "…" : "Retry"}
      </Button>
    );
  }

  if (job.status === "awaiting_approval") {
    return (
      <span className="flex items-center justify-end gap-1.5">
        <Button
          aria-label={`Reject job ${job.id.slice(0, 8)}`}
          disabled={acting}
          onClick={handleRejectClick}
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
        >
          Reject
        </Button>
        <Button
          aria-label={`Approve and post job ${job.id.slice(0, 8)}`}
          disabled={acting}
          onClick={handleApproveClick}
          size="sm"
          className="h-7 text-xs"
        >
          {acting ? "…" : "Approve"}
        </Button>
      </span>
    );
  }

  return <span className="text-xs text-muted-foreground">—</span>;
}
