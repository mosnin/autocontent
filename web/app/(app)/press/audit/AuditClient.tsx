"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ChevronRight, Copy, Gauge, ScanSearch } from "lucide-react";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  analyticsKeys,
  auditsFetcher,
  cannibalizationFetcher,
  humanizeAnalyticsError,
  runAudit,
  scanCannibalization,
  type ArticleAudit,
  type CannibalizationFinding,
} from "@/lib/press-analytics-client";
import type { Article } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Finding {
  code?: string;
  severity?: string;
  message?: string;
}

export function AuditClient({
  initialAudits,
  initialFindings,
  articles,
}: {
  initialAudits: ArticleAudit[];
  initialFindings: CannibalizationFinding[];
  articles: Article[];
}) {
  const titles = React.useMemo(
    () => new Map(articles.map((a) => [a.id, a.title || a.topic])),
    [articles],
  );

  const { data: audits, mutate: mutateAudits } = useSWR<ArticleAudit[]>(
    analyticsKeys.audits(),
    auditsFetcher,
    { fallbackData: initialAudits },
  );
  const {
    data: findings,
    mutate: mutateFindings,
  } = useSWR<CannibalizationFinding[]>(
    analyticsKeys.cannibalization(),
    cannibalizationFetcher,
    { fallbackData: initialFindings },
  );

  const [running, setRunning] = React.useState(false);
  const [scanning, setScanning] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const sortedAudits = (audits ?? []).slice().sort((a, b) => a.score - b.score);
  const sortedFindings = (findings ?? []).slice().sort((a, b) => b.similarity - a.similarity);
  const needsAttention = sortedAudits.filter((a) => a.score < 50).length;

  async function handleRunAudit() {
    setRunning(true);
    try {
      const summary = await runAudit();
      if (summary.audited === 0) {
        toast.info("No done articles to audit yet");
      } else {
        toast.success(
          `Audited ${summary.audited} article${summary.audited === 1 ? "" : "s"}, ${summary.low_score_count} need attention`,
        );
      }
      void mutateAudits();
    } catch (err) {
      toast.error(humanizeAnalyticsError(err));
    } finally {
      setRunning(false);
    }
  }

  async function handleScan() {
    setScanning(true);
    try {
      const result = await scanCannibalization();
      toast.success(
        `${result.length} cannibalization pair${result.length === 1 ? "" : "s"} found`,
      );
      void mutateFindings();
    } catch (err) {
      toast.error(humanizeAnalyticsError(err));
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Content audit</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Score every done article from stored data: quality, freshness,
            hero image, meta description, and internal links. No LLM call.
          </p>
        </div>
        <Button onClick={() => void handleRunAudit()} disabled={running} isLoading={running}>
          <Gauge className="h-4 w-4" aria-hidden="true" />
          Run audit
        </Button>
      </div>

      {sortedAudits.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="rounded-full bg-muted p-3">
              <Gauge className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold">No audit results yet</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Run an audit to score every done article in the corpus.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {needsAttention > 0 && (
            <p className="text-sm text-muted-foreground">
              {needsAttention} article{needsAttention === 1 ? "" : "s"} need attention (score
              below 50).
            </p>
          )}
          <Card className="gap-0 overflow-hidden py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[1%]" />
                  <TableHead>Article</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead>Flag</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedAudits.map((a) => (
                  <React.Fragment key={a.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                    >
                      <TableCell>
                        {expanded === a.id ? (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                        )}
                      </TableCell>
                      <TableCell className="max-w-[320px] truncate font-medium">
                        <Link
                          href={`/articles/${a.article_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:underline"
                        >
                          {titles.get(a.article_id) ?? a.article_id}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">
                        <ScoreBadge score={a.score} />
                      </TableCell>
                      <TableCell>
                        {a.score < 50 ? (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                            Needs attention
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                    {expanded === a.id && (
                      <TableRow>
                        <TableCell colSpan={4} className="bg-muted/20">
                          <FindingsList findings={a.findings as Finding[]} />
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Cannibalization</h2>
            <p className="max-w-xl text-sm text-muted-foreground">
              Article pairs whose title and focus keyword overlap enough
              that they&apos;re likely competing for the same search
              intent.
            </p>
          </div>
          <Button variant="outline" onClick={() => void handleScan()} disabled={scanning} isLoading={scanning}>
            <ScanSearch className="h-4 w-4" aria-hidden="true" />
            Scan
          </Button>
        </div>

        {sortedFindings.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="rounded-full bg-muted p-3">
                <Copy className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
              </div>
              <h3 className="text-lg font-semibold">No cannibalization found</h3>
              <p className="max-w-sm text-sm text-muted-foreground">
                Run a scan to check the corpus for overlapping articles.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="gap-0 overflow-hidden py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Article A</TableHead>
                  <TableHead>Article B</TableHead>
                  <TableHead>Keyword</TableHead>
                  <TableHead className="text-right">Similarity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedFindings.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="max-w-[220px] truncate">
                      <Link href={`/articles/${f.article_a}`} className="hover:underline">
                        {titles.get(f.article_a) ?? f.article_a}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate">
                      <Link href={`/articles/${f.article_b}`} className="hover:underline">
                        {titles.get(f.article_b) ?? f.article_b}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {f.keyword || "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {Math.round(f.similarity * 100)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const variant: BadgeVariant = score < 50 ? "destructive" : score < 80 ? "warning" : "success";
  return (
    <Badge variant={variant} className="font-mono">
      {Math.round(score)}
    </Badge>
  );
}

function FindingsList({ findings }: { findings: Finding[] }) {
  if (!findings || findings.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">No findings recorded.</p>;
  }
  return (
    <ul className="space-y-1.5 py-2">
      {findings.map((f, i) => (
        <li key={i} className="flex items-center gap-2 text-sm">
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              f.severity === "high"
                ? "bg-destructive"
                : f.severity === "medium"
                  ? "bg-warning"
                  : "bg-muted-foreground",
            )}
            aria-hidden="true"
          />
          <span className="text-muted-foreground">{f.message ?? f.code ?? "unknown"}</span>
        </li>
      ))}
    </ul>
  );
}
