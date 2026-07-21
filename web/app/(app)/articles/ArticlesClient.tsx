"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { Plus, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DashHeading, DashPanel } from "@/components/hub/dashboard-kit";
import { hubCardClass } from "@/components/hub/primitives";
import { cn } from "@/lib/utils";
import { createArticleAction, retryArticleAction } from "@/lib/actions";
import { clientFetch } from "@/lib/client-fetcher";
import {
  ARTICLE_IN_PROGRESS,
  articleStatusLabel,
  ArticleStatusBadge,
} from "@/lib/status-badge";
import type { Article, ArticleStatus, Niche } from "@/lib/types";

const POLL_MS = 10_000;

type Filter = "all" | "in_progress" | "done" | "failed";

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

export function ArticlesClient({
  initial,
  niches,
}: {
  initial: Article[];
  niches: Niche[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [filter, setFilter] = React.useState<Filter>("all");
  // The command palette's "New article" action deep-links here with
  // ?new=1 so it can pop the dialog open on arrival.
  const [newOpen, setNewOpen] = React.useState(
    () => searchParams.get("new") === "1",
  );

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

  const inProgressCount = articles.filter((a) =>
    matches(a, "in_progress"),
  ).length;
  const filtered = articles.filter((a) => matches(a, filter));

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

  return (
    <div className="space-y-10">
      <DashHeading
        as="h1"
        sub={`SEO-optimized written content — updates every ${POLL_MS / 1000}s.`}
      >
        Bring any keyword to page one
      </DashHeading>

      <DashPanel
        actions={
          <Button onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New article
          </Button>
        }
        delay={0.1}
        title="All articles"
      >
      {error && (
        <p className="mb-4 text-sm text-muted-foreground">
          Live updates paused — {error.message ?? "fetch failed"}
        </p>
      )}

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <ScrollArea>
          <TabsList className="w-max">
            <TabsTrigger value="all">
              All
              <TabCount value={articles.length} />
            </TabsTrigger>
            <TabsTrigger value="in_progress">
              {inProgressCount > 0 && (
                <span aria-hidden className="relative mr-0.5 flex size-2">
                  <span className="relative inline-flex size-2 rounded-full bg-brand" />
                </span>
              )}
              In progress
              <TabCount value={inProgressCount} live={inProgressCount > 0} />
            </TabsTrigger>
            <TabsTrigger value="done">
              Done
              <TabCount
                value={articles.filter((a) => a.status === "done").length}
              />
            </TabsTrigger>
            <TabsTrigger value="failed">
              Failed
              <TabCount
                value={articles.filter((a) => a.status === "failed").length}
              />
            </TabsTrigger>
          </TabsList>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        <TabsContent value={filter} className="mt-4">
          {filtered.length === 0 ? (
            <EmptyState filter={filter} onNew={() => setNewOpen(true)} />
          ) : (
            <div className="overflow-x-auto">
              <Card className={cn(hubCardClass, "min-w-[640px] overflow-hidden")}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[140px]">Status</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead className="w-[160px]">Niche</TableHead>
                      <TableHead className="w-[90px] text-right">
                        Words
                      </TableHead>
                      <TableHead className="w-[120px]">Created</TableHead>
                      <TableHead className="w-[110px] text-right">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((a) => (
                      <ArticleRow
                        key={a.id}
                        article={a}
                        nicheTitle={nicheTitles.get(a.niche_id)}
                        onClick={() => router.push(`/articles/${a.id}`)}
                        onRetry={handleRetry}
                      />
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
      </DashPanel>

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

function EmptyState({
  filter,
  onNew,
}: {
  filter: Filter;
  onNew: () => void;
}) {
  const label =
    filter === "all"
      ? "No articles yet"
      : `No ${filter.replace("_", " ")} articles`;

  return (
    <Card className={hubCardClass}>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <h3 className="text-lg font-semibold">{label}</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          {filter === "all"
            ? "Kick off the written-content pipeline for one of your niches."
            : "No articles match this filter right now."}
        </p>
        {filter === "all" && (
          <Button size="sm" variant="outline" onClick={onNew}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            New article
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function ArticleRow({
  article,
  nicheTitle,
  onClick,
  onRetry,
}: {
  article: Article;
  nicheTitle: string | undefined;
  onClick: () => void;
  onRetry: (article: Article) => Promise<void>;
}) {
  const [retrying, setRetrying] = React.useState(false);

  async function handleRetryClick(e: React.MouseEvent) {
    e.stopPropagation();
    setRetrying(true);
    await onRetry(article);
    setRetrying(false);
  }

  const badge = <ArticleStatusBadge status={article.status} />;

  return (
    <TableRow
      onClick={onClick}
      role="button"
      className="group cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={`Open article ${article.id.slice(0, 8)}, status ${articleStatusLabel(article.status)}`}
    >
      <TableCell>
        {article.status === "failed" && article.error ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">{badge}</span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="break-words">{article.error}</p>
            </TooltipContent>
          </Tooltip>
        ) : (
          badge
        )}
      </TableCell>
      <TableCell className="max-w-[420px] truncate">
        {article.title ? (
          <span className="font-medium">{article.title}</span>
        ) : (
          <span className="italic text-muted-foreground">{article.topic}</span>
        )}
      </TableCell>
      <TableCell className="max-w-[160px] truncate text-muted-foreground">
        {nicheTitle ?? "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {article.word_count != null ? article.word_count.toLocaleString() : "—"}
      </TableCell>
      <TableCell className="tabular-nums text-muted-foreground">
        {relative(article.created_at)}
      </TableCell>
      <TableCell className="text-right">
        {article.status === "failed" && (
          <Button
            size="sm"
            variant="destructive"
            onClick={handleRetryClick}
            disabled={retrying}
            aria-label={`Retry article ${article.id.slice(0, 8)}`}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            {retrying ? "…" : "Retry"}
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

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
              <Select value={nicheId} onValueChange={setNicheId}>
                <SelectTrigger id="article-niche" className="w-full">
                  <SelectValue placeholder="Pick a niche" />
                </SelectTrigger>
                <SelectContent>
                  {active.map((n) => (
                    <SelectItem key={n.id} value={n.id}>
                      {n.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <Input
                id="article-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Best budget espresso machines in 2026"
                maxLength={200}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!nicheId || submitting}>
              {submitting ? "Enqueuing…" : "Write article"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TabCount({ value, live }: { value: number; live?: boolean }) {
  return (
    <span
      className={
        live
          ? "ml-1.5 rounded-full bg-brand/15 px-1.5 text-[11px] font-medium tabular-nums text-brand"
          : "ml-1.5 rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground"
      }
    >
      {value}
    </span>
  );
}
