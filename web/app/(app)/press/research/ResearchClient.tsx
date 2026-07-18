"use client";

import * as React from "react";
import useSWR from "swr";
import { FileSearch, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { pressKeys, researchFetcher } from "@/lib/press-client";
import type { Article, ArticleResearch } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ResearchClient({ articles }: { articles: Article[] }) {
  const [selected, setSelected] = React.useState<string | null>(
    articles[0]?.id ?? null,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">SERP analysis</h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          The competitive research the pipeline gathered before writing each
          article: top-ranking pages, common headings, and the questions
          searchers ask.
        </p>
      </div>

      {articles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="rounded-full bg-muted p-3">
              <FileSearch className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold">No finished articles yet</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Research shows up here once an article has finished the pipeline.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-6 lg:flex-row">
          <Card className="min-w-0 gap-0 overflow-hidden py-0 lg:w-2/5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Article</TableHead>
                  <TableHead className="w-[90px] text-right">Words</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {articles.map((a) => (
                  <TableRow
                    key={a.id}
                    onClick={() => setSelected(a.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(a.id);
                      }
                    }}
                    className={cn(
                      "cursor-pointer",
                      selected === a.id && "bg-muted/60",
                    )}
                  >
                    <TableCell className="max-w-[280px] truncate font-medium">
                      {a.title || a.topic}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {a.word_count != null ? a.word_count.toLocaleString() : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <div className="min-w-0 flex-1">
            {selected ? (
              <ResearchDetail articleId={selected} />
            ) : (
              <Card>
                <CardContent className="py-16 text-center text-sm text-muted-foreground">
                  Pick an article to see its research.
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ResearchDetail({ articleId }: { articleId: string }) {
  const { data, isLoading } = useSWR<ArticleResearch>(
    pressKeys.research(articleId),
    researchFetcher,
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    );
  }

  const serp = data?.serp_analysis;

  if (!serp) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="rounded-full bg-muted p-3">
            <Search className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-semibold">No stored research</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            This article was likely generated before research persistence
            was added, so there's nothing cached to show.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-4">
          <Stat label="Avg word count" value={serp.avgWordCount} />
          <Stat label="Recommended" value={serp.recommendedWordCount} />
          <Stat label="Top results" value={serp.topResults.length} />
          <Stat label="Questions found" value={serp.questionsAnswered.length} />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {serp.commonTopics.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Common topics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                {serp.commonTopics.map((t) => (
                  <Badge key={t} variant="outline" className="font-normal">
                    {t}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {serp.commonHeadings.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Common headings</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {serp.commonHeadings.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {serp.questionsAnswered.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Questions answered</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {serp.questionsAnswered.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {serp.topDomains.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top domains</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                {serp.topDomains.map((d) => (
                  <Badge key={d} variant="outline" className="font-normal">
                    {d}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {serp.topResults.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top-ranking pages</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {serp.topResults.map((r, i) => (
                <li key={i} className="rounded-md border p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 truncate font-medium text-brand hover:underline"
                    >
                      {r.title}
                    </a>
                    {r.wordCountEstimate != null && (
                      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                        {r.wordCountEstimate.toLocaleString()} words
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {r.domain}
                  </p>
                  {r.highlights.length > 0 && (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                      {r.highlights.map((h, j) => (
                        <li key={j}>{h}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
        {label}
      </p>
      <p className="mt-1 font-mono text-xl font-semibold tabular-nums">
        {value.toLocaleString()}
      </p>
    </div>
  );
}
