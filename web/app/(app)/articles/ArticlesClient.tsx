"use client";

// Square UI "marketing-dashboard" template campaigns-table, ported to the
// articles list — same TanStack table anatomy (toolbar with search +
// status filter dropdown with live counts + primary action, sortable
// headers, row-selection checkbox column, template badge palette, full
// pagination footer) as components/square/campaigns-table.tsx /
// app/(app)/queue/QueueClient.tsx. Adaptations are real-data mapping +
// our routes only, and every bit of existing behavior is preserved
// byte-identical:
//   - the same SWR poll (POLL_MS, fallbackData: initial), the same
//     first-error-only toast dedupe, and the same optimistic
//     failed -> queued retry + revert-on-failure.
//   - the same ?new=1 deep link opens the dialog on arrival.
//   - the template's single status "Filter" dropdown replaces the old
//     Tabs, with the same Filter type and matches() semantics — now with
//     live counts per option, same technique as queue/QueueClient.tsx.
//   - mock `campaigns` become the polled `articles`; columns map to real
//     fields: status, title (falls back to topic), niche (resolved via
//     the nicheTitles map — real title or "—"), words, created (relative
//     time, same helper as before).
//   - the template's "New campaign" button becomes "New article", which
//     still opens the exact-same NewArticleDialog component, unchanged.
//   - retry stays a real per-row action (SWR optimistic update + server
//     action), rendered in an actions column since the template has no
//     equivalent (campaigns has no per-row actions).
//   - template columns with no real counterpart (avatar image, budget,
//     ends, objective) are dropped rather than faked.

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
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
import { Button as DialogButton } from "@/components/ui/button";
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
  Select as DialogSelect,
  SelectContent as DialogSelectContent,
  SelectItem as DialogSelectItem,
  SelectTrigger as DialogSelectTrigger,
  SelectValue as DialogSelectValue,
} from "@/components/ui/select";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/square/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input as DialogInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DashHeading } from "@/components/hub/dashboard-kit";
import { createArticleAction, retryArticleAction } from "@/lib/actions";
import { clientFetch } from "@/lib/client-fetcher";
import { ARTICLE_IN_PROGRESS, articleStatusLabel } from "@/lib/status-badge";
import type { Article, ArticleStatus, Niche } from "@/lib/types";

const POLL_MS = 10_000;

type Filter = "all" | "in_progress" | "done" | "failed";

const FILTERS: Filter[] = ["all", "in_progress", "done", "failed"];

const FILTER_LABEL: Record<Filter, string> = {
  all: "All statuses",
  in_progress: "In progress",
  done: "Done",
  failed: "Failed",
};

function matches(article: Article, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "done") return article.status === "done";
  if (filter === "failed") return article.status === "failed";
  if (filter === "in_progress")
    return (
      article.status === "queued" || ARTICLE_IN_PROGRESS.has(article.status)
    );
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

// Template badge palette (border-neutral / blue / emerald / rose) mapped
// onto the real ArticleStatus enum — same technique as
// queue/QueueClient.tsx / calendar/CalendarClient.tsx StatusBadge.
function StatusBadge({ status }: { status: ArticleStatus }) {
  const label = articleStatusLabel(status);
  if (status === "queued") {
    return (
      <Badge variant="outline" className="text-xs font-medium px-2 py-0.5 border text-muted-foreground bg-transparent">
        {label}
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
  if (status === "failed") {
    return (
      <Badge
        variant="outline"
        className="text-xs font-medium px-2 py-0.5 bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400 border-rose-200 dark:border-rose-900"
      >
        Failed
      </Badge>
    );
  }
  // researching / outlining / writing / qa / metadata / imaging
  return (
    <Badge
      variant="outline"
      className="text-xs font-medium px-2 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 border-blue-200 dark:border-blue-900"
    >
      {label}
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

export function ArticlesClient({
  initial,
  niches,
}: {
  initial: Article[];
  niches: Niche[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // The command palette's "New article" action deep-links here with
  // ?new=1 so it can pop the dialog open on arrival.
  const [newOpen, setNewOpen] = React.useState(
    () => searchParams.get("new") === "1",
  );
  const [filter, setFilter] = React.useState<Filter>("all");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [rowSelection, setRowSelection] = React.useState({});

  const { data, error, mutate } = useSWR<Article[]>(
    "/api/v1/articles?limit=100",
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

  const articles = data ?? [];
  const nicheTitles = React.useMemo(
    () => new Map(niches.map((n) => [n.id, n.title])),
    [niches],
  );

  const counts = React.useMemo(
    () => ({
      all: articles.length,
      in_progress: articles.filter((a) => matches(a, "in_progress")).length,
      done: articles.filter((a) => matches(a, "done")).length,
      failed: articles.filter((a) => matches(a, "failed")).length,
    }),
    [articles],
  );

  async function handleRetry(article: Article) {
    const prevArticles = articles;

    // Optimistically move the article from "failed" back to "queued".
    const optimistic = articles.map((a) =>
      a.id === article.id ? { ...a, status: "queued" as ArticleStatus } : a,
    );
    void mutate(optimistic, false);

    const fd = new FormData();
    fd.set("article_id", article.id);
    const res = await retryArticleAction({ ok: false }, fd);

    if (res.ok) {
      toast.success("Retry enqueued");
      void mutate();
    } else {
      void mutate(prevArticles, false);
      toast.error(res.error ?? "Retry failed");
    }
  }

  const columns = React.useMemo<ColumnDef<Article>[]>(
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
        accessorKey: "status",
        header: ({ column }) => (
          <SortableHeader
            label="Status"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => {
          const article = row.original;
          const badge = <StatusBadge status={article.status} />;
          if (article.status === "failed" && article.error) {
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">{badge}</span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="break-words">{article.error}</p>
                </TooltipContent>
              </Tooltip>
            );
          }
          return badge;
        },
      },
      {
        id: "title",
        accessorFn: (article) => article.title ?? article.topic,
        header: ({ column }) => (
          <SortableHeader
            label="Title"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => {
          const article = row.original;
          return (
            <Link
              href={`/articles/${article.id}`}
              className="block max-w-[360px] truncate text-sm font-medium hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {article.title ? (
                article.title
              ) : (
                <span className="italic text-muted-foreground">
                  {article.topic}
                </span>
              )}
            </Link>
          );
        },
      },
      {
        id: "niche",
        accessorFn: (article) => nicheTitles.get(article.niche_id) ?? "",
        header: ({ column }) => (
          <SortableHeader
            label="Niche"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span className="inline-block max-w-[200px] truncate align-middle text-sm text-muted-foreground">
            {nicheTitles.get(row.original.niche_id) ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "word_count",
        header: ({ column }) => (
          <SortableHeader
            label="Words"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {row.original.word_count != null
              ? row.original.word_count.toLocaleString()
              : "—"}
          </span>
        ),
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
          <span className="text-sm tabular-nums text-muted-foreground">
            {relative(row.original.created_at)}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => (
          <span className="text-xs font-medium text-muted-foreground">
            Actions
          </span>
        ),
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions article={row.original} onRetry={handleRetry} />
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nicheTitles],
  );

  const filteredData = React.useMemo(() => {
    let result = articles.filter((a) => matches(a, filter));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((a) => {
        const title = (a.title ?? a.topic).toLowerCase();
        const niche = (nicheTitles.get(a.niche_id) ?? "").toLowerCase();
        return title.includes(q) || niche.includes(q);
      });
    }
    return result;
  }, [articles, filter, searchQuery, nicheTitles]);

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
      <DashHeading
        as="h1"
        sub={`SEO-optimized written content — updates every ${POLL_MS / 1000}s.`}
      >
        Bring any keyword to page one
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
              placeholder="Search articles..."
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
          <Button size="sm" className="h-8 gap-1.5 ml-auto" onClick={() => setNewOpen(true)}>
            <span className="hidden sm:inline">New article</span>
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
                    onClick={() => router.push(`/articles/${row.original.id}`)}
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
                      ? "No articles yet. Kick off the written-content pipeline for one of your niches."
                      : "No articles match this filter."}
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
                ? "0 articles"
                : `Showing ${from} to ${to} of ${totalRows} articles`}
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

      <NewArticleDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        niches={niches}
        onCreated={(article) => {
          void mutate();
          router.push(`/articles/${article.id}`);
        }}
      />
    </div>
  );
}

function RowActions({
  article,
  onRetry,
}: {
  article: Article;
  onRetry: (article: Article) => Promise<void>;
}) {
  const [retrying, setRetrying] = React.useState(false);

  async function handleRetryClick(e: React.MouseEvent) {
    e.stopPropagation();
    setRetrying(true);
    await onRetry(article);
    setRetrying(false);
  }

  if (article.status !== "failed") {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <Button
      size="sm"
      variant="destructive"
      className="h-7 text-xs"
      onClick={handleRetryClick}
      disabled={retrying}
      aria-label={`Retry article ${article.id.slice(0, 8)}`}
    >
      {retrying ? "…" : "Retry"}
    </Button>
  );
}

// --- New-article dialog (unchanged wiring) ------------------------------
// Kept on the app's own Dialog/Select/Input/Label primitives: dialog,
// select-in-a-form, and label have no square/ui counterpart the template
// prescribes for this context (established precedent — see repo-wide
// notes), and this component's logic/markup is otherwise untouched.

function NewArticleDialog({
  open,
  onOpenChange,
  niches,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  niches: Niche[];
  onCreated: (article: Article) => void;
}) {
  const active = niches.filter((n) => !n.archived_at);
  const [nicheId, setNicheId] = React.useState<string>(active[0]?.id ?? "");
  const [topic, setTopic] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nicheId) {
      toast.error("Pick a niche first");
      return;
    }
    setSubmitting(true);
    const fd = new FormData();
    fd.set("niche_id", nicheId);
    fd.set("topic", topic.trim());
    const res = await createArticleAction({ ok: false }, fd);
    setSubmitting(false);
    if (res.ok && res.article) {
      toast.success("Article enqueued — the pipeline is on it");
      onOpenChange(false);
      setTopic("");
      onCreated(res.article);
    } else {
      toast.error(res.error ?? "Failed to enqueue article");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} className="space-y-5">
          <DialogHeader>
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
              New article
            </p>
            <DialogTitle>Write an SEO article</DialogTitle>
            <DialogDescription>
              The pipeline researches, outlines, writes, and QAs the piece.
              Leave the topic blank and it picks one for the niche.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="article-niche">Niche</Label>
              <DialogSelect value={nicheId} onValueChange={setNicheId}>
                <DialogSelectTrigger id="article-niche" className="w-full">
                  <DialogSelectValue placeholder="Pick a niche" />
                </DialogSelectTrigger>
                <DialogSelectContent>
                  {active.map((n) => (
                    <DialogSelectItem key={n.id} value={n.id}>
                      {n.title}
                    </DialogSelectItem>
                  ))}
                </DialogSelectContent>
              </DialogSelect>
              {active.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  You need at least one active niche to write an article.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="article-topic">
                Topic{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <DialogInput
                id="article-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Best budget espresso machines in 2026"
                maxLength={200}
              />
            </div>
          </div>

          <DialogFooter>
            <DialogButton
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </DialogButton>
            <DialogButton type="submit" disabled={!nicheId || submitting}>
              {submitting ? "Enqueuing…" : "Write article"}
            </DialogButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
