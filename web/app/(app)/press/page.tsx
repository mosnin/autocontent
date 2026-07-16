import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArticleStatusBadge } from "@/lib/status-badge";
import { api } from "@/lib/api";
import type { Article } from "@/lib/types";

export const dynamic = "force-dynamic";

// Press product home: the written-content dashboard. Text-and-numbers-first —
// no decorative icons — assembled from the live articles data.
export default async function PressOverviewPage() {
  let articles: Article[] = [];
  try {
    articles = await api<Article[]>("/api/v1/articles?limit=100");
  } catch {
    articles = [];
  }

  const done = articles.filter((a) => a.status === "done");
  const failed = articles.filter((a) => a.status === "failed");
  const inFlight = articles.length - done.length - failed.length;
  const words = done.reduce((sum, a) => sum + (a.word_count ?? 0), 0);
  const avgQuality =
    done.length > 0
      ? done.reduce((s, a) => s + (a.quality?.overall ?? 0), 0) / done.length
      : null;
  const recent = articles.slice(0, 6);

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">Press</h1>
          <p className="max-w-xl text-[15px] text-muted-foreground">
            Long-form articles, researched and written for search: SEO
            metadata, structured data, and internal links included.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/articles">New article</Link>
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border/60 bg-border/60 sm:grid-cols-4">
        <Stat label="Published-ready" value={String(done.length)} />
        <Stat label="In production" value={String(inFlight)} />
        <Stat
          label="Words written"
          value={words >= 1000 ? `${(words / 1000).toFixed(1)}k` : String(words)}
        />
        <Stat
          label="Avg quality"
          value={avgQuality === null ? "-" : `${Math.round(avgQuality * 100)}%`}
        />
      </div>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Recent</h2>
          <Link
            href="/articles"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            All articles
          </Link>
        </div>

        {recent.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <h3 className="text-lg font-semibold">No articles yet</h3>
              <p className="max-w-sm text-sm text-muted-foreground">
                Generate your first SEO article. Pick a channel and the
                pipeline researches, outlines, writes, and scores it.
              </p>
              <Button asChild size="sm">
                <Link href="/articles">Write the first one</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="gap-0 overflow-hidden py-0">
            <ul className="divide-y divide-border/60">
              {recent.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/articles/${a.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3.5 transition-colors hover:bg-muted/40"
                  >
                    <span className="min-w-0 flex-1 basis-64 truncate text-sm font-medium">
                      {a.title || a.topic}
                    </span>
                    {a.word_count ? (
                      <span className="hidden font-mono text-xs tabular-nums text-muted-foreground sm:inline">
                        {a.word_count.toLocaleString()} words
                      </span>
                    ) : null}
                    <ArticleStatusBadge status={a.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {failed.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {failed.length} article{failed.length === 1 ? "" : "s"} failed:{" "}
          <Link
            href="/articles"
            className="font-medium text-foreground underline underline-offset-4"
          >
            review and retry
          </Link>
          .
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-5 py-6">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
        {label}
      </p>
      <p className="mt-2 font-mono text-3xl font-semibold tabular-nums tracking-tight">
        {value}
      </p>
    </div>
  );
}
