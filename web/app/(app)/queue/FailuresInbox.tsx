"use client";

/**
 * Failures inbox — a consolidated, categorized view of everything that
 * has terminally failed across a user's jobs, image posts, and articles.
 *
 * Today a failure is only visible on its own product's detail page, so
 * operators either miss it or have to hunt product-by-product. This
 * component groups the caller's recent failures by a coarse triage
 * category (spend cap, render QA, content QA, provider error,
 * timeout/stuck, other) and lets them replay any one of them in place —
 * the Retry button hits the same consolidated replay endpoint, which
 * itself delegates to each surface's existing retry mechanism.
 *
 * Self-contained: fetches its own data via SWR against the existing
 * `/api/proxy` passthrough (same pattern QueueClient uses), so the
 * orchestrator can drop `<FailuresInbox />` into the queue page (or
 * anywhere else) without wiring props.
 */
import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";

import { Badge } from "@/components/square/ui/badge";
import { Button } from "@/components/square/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/square/ui/card";
import { clientFetch } from "@/lib/client-fetcher";

const POLL_MS = 15000;

type FailureKind = "job" | "image_post" | "article";

type FailureCategory =
  | "content_qa"
  | "render_qa"
  | "spend_cap"
  | "timeout_stuck"
  | "provider_error"
  | "other";

interface FailureItem {
  kind: FailureKind;
  id: string;
  niche_id: string | null;
  niche_title: string | null;
  label: string;
  error: string | null;
  category: FailureCategory;
  created_at: string | null;
}

interface FailuresInboxResponse {
  failures: FailureItem[];
  counts: Record<string, number>;
  total: number;
}

const CATEGORY_LABELS: Record<FailureCategory, string> = {
  spend_cap: "Spend cap",
  render_qa: "Render QA",
  content_qa: "Content QA",
  provider_error: "Provider error",
  timeout_stuck: "Timeout / stuck",
  other: "Other",
};

// Ordered so the most actionable categories (things a human can likely
// fix or that most warrant attention) surface first.
const CATEGORY_ORDER: FailureCategory[] = [
  "spend_cap",
  "provider_error",
  "timeout_stuck",
  "render_qa",
  "content_qa",
  "other",
];

const KIND_LABELS: Record<FailureKind, string> = {
  job: "Video",
  image_post: "Image post",
  article: "Article",
};

function relative(iso: string | null): string {
  if (!iso) return "unknown time";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function categoryBadgeVariant(
  category: FailureCategory,
): "destructive" | "outline" | "secondary" {
  if (category === "spend_cap" || category === "provider_error") return "destructive";
  if (category === "timeout_stuck") return "secondary";
  return "outline";
}

async function fetcher(path: string): Promise<FailuresInboxResponse> {
  return clientFetch<FailuresInboxResponse>(path);
}

function ReplayButton({
  item,
  onReplayed,
}: {
  item: FailureItem;
  onReplayed: () => void;
}) {
  const [pending, setPending] = React.useState(false);

  async function onClick() {
    setPending(true);
    try {
      const res = await fetch(`/api/proxy/api/v1/failures/replay/${item.kind}/${item.id}`, {
        method: "POST",
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status} ${body}`);
      }
      toast.success("Replay enqueued");
      onReplayed();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Replay failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={pending}>
      {pending ? "Replaying…" : "Retry"}
    </Button>
  );
}

function FailureRow({
  item,
  onReplayed,
}: {
  item: FailureItem;
  onReplayed: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-card/50 p-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{KIND_LABELS[item.kind]}</Badge>
          <Badge variant={categoryBadgeVariant(item.category)}>
            {CATEGORY_LABELS[item.category]}
          </Badge>
          {item.niche_title && (
            <span className="truncate text-sm font-medium">{item.niche_title}</span>
          )}
          <span className="text-xs text-muted-foreground">{item.label}</span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">{relative(item.created_at)}</span>
        </div>
        <p className="line-clamp-2 break-words text-sm text-muted-foreground">
          {item.error ?? "(no error message recorded)"}
        </p>
      </div>
      <ReplayButton item={item} onReplayed={onReplayed} />
    </div>
  );
}

export function FailuresInbox() {
  const { data, error, isLoading, mutate } = useSWR<FailuresInboxResponse>(
    "/api/v1/failures?limit=100",
    fetcher,
    { refreshInterval: POLL_MS },
  );

  const [activeCategory, setActiveCategory] = React.useState<FailureCategory | "all">("all");

  if (isLoading && !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Failures inbox</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Loading failures…</CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Failures inbox</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-destructive">
          Couldn&apos;t load failures: {error instanceof Error ? error.message : String(error)}
        </CardContent>
      </Card>
    );
  }

  const failures = data?.failures ?? [];
  const counts = data?.counts ?? {};
  const visible =
    activeCategory === "all"
      ? failures
      : failures.filter((f) => f.category === activeCategory);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Failures inbox
          {data && data.total > 0 && (
            <Badge variant="destructive">{data.total}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button
            variant={activeCategory === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveCategory("all")}
          >
            All ({data?.total ?? 0})
          </Button>
          {CATEGORY_ORDER.filter((c) => (counts[c] ?? 0) > 0).map((c) => (
            <Button
              key={c}
              variant={activeCategory === c ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveCategory(c)}
            >
              {CATEGORY_LABELS[c]} ({counts[c] ?? 0})
            </Button>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {failures.length === 0
              ? "No failures — everything's healthy."
              : "No failures in this category."}
          </p>
        ) : (
          <div className="space-y-2">
            {visible.map((item) => (
              <FailureRow
                key={`${item.kind}:${item.id}`}
                item={item}
                onReplayed={() => mutate()}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Re-exported so callers that only need the badge coloring convention
// (e.g. a future admin cross-tenant view) don't have to duplicate it.
export { CATEGORY_LABELS, categoryBadgeVariant };
export type { FailureCategory, FailureItem, FailuresInboxResponse };
