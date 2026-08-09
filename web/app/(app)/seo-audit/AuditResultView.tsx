"use client";

// The audit result IS the product, so this component is the centre of the
// surface: score + band, the six weighted categories, then every rule with
// its evidence and recommendation.
//
// The one thing that must never blur: an `na` item did NOT fail. It means the
// rule did not apply to this page, so it was removed from its category's
// denominator entirely. It is rendered muted, labelled "Didn't apply", shows
// no points (its max_score is 0 by construction), and is grouped after the
// scored rules — never in the destructive register.

import * as React from "react";
import {
  AlertTriangle,
  Check,
  CircleSlash,
  Copy,
  Download,
  Minus,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Metric, Provenance, Section } from "@/components/editorial";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  AUDIT_STATUS_CLASSES,
  AUDIT_STATUS_LABELS,
  bandClass,
  promptDownloadUrl,
  type AuditCategory,
  type AuditItem,
  type AuditStatus,
  type StoredAudit,
} from "@/lib/seo-audit-client";

const STATUS_ICON: Record<AuditStatus, React.ComponentType<{ className?: string }>> = {
  pass: Check,
  partial: Minus,
  fail: X,
  na: CircleSlash,
};

/** Order rules so the actionable ones lead and the inapplicable ones settle
 *  at the bottom, where they read as context rather than as debt. */
const STATUS_RANK: Record<AuditStatus, number> = { fail: 0, partial: 1, pass: 2, na: 3 };

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Your browser blocked the clipboard — select and copy manually.");
  }
}

function StatusChip({ status }: { status: AuditStatus }) {
  const Icon = STATUS_ICON[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        AUDIT_STATUS_CLASSES[status],
      )}
    >
      <Icon className="size-3" aria-hidden />
      {AUDIT_STATUS_LABELS[status]}
    </span>
  );
}

function RuleRow({ item }: { item: AuditItem }) {
  const isNa = item.status === "na";
  return (
    <li
      className={cn(
        "flex flex-col gap-2 border-t px-4 py-3 sm:flex-row sm:items-start sm:gap-4",
        isNa && "bg-muted/20",
      )}
    >
      <div className="flex items-center gap-2 sm:w-40 sm:shrink-0">
        <StatusChip status={item.status} />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={cn("text-sm font-medium", isNa && "text-muted-foreground")}>
            {item.label}
          </span>
          <code className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {item.id}
          </code>
        </div>
        {item.evidence ? (
          <p className="text-xs text-muted-foreground">{item.evidence}</p>
        ) : null}
        {/* An N/A rule has no recommendation worth acting on — showing one
            would re-import it as work. */}
        {!isNa && item.status !== "pass" && item.recommendation ? (
          <p className="text-xs text-foreground/80">
            <span className="font-medium">Fix: </span>
            {item.recommendation}
          </p>
        ) : null}
      </div>
      <div className="shrink-0 text-right sm:w-24">
        {isNa ? (
          <span className="text-xs text-muted-foreground">
            Not scored
          </span>
        ) : (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {item.score.toFixed(1)} / {item.max_score.toFixed(1)}
          </span>
        )}
      </div>
    </li>
  );
}

function CategoryCard({ category }: { category: AuditCategory }) {
  const pct = category.max_score > 0 ? (category.score / category.max_score) * 100 : 0;
  const failing = category.items.filter(
    (i) => i.status === "fail" || i.status === "partial",
  ).length;
  const [open, setOpen] = React.useState(failing > 0);
  const items = [...category.items].sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.max_score - a.max_score,
  );

  return (
    <Card className="gap-0 py-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded-t-xl px-4 py-4 text-left transition-colors hover:bg-muted/30"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-semibold">
            <span className="mr-2 font-mono text-xs text-muted-foreground">
              {category.id}
            </span>
            {category.name}
          </span>
          <span className="font-mono text-sm tabular-nums">
            {category.score.toFixed(1)}
            <span className="text-muted-foreground"> / {category.max_score.toFixed(1)}</span>
          </span>
        </div>
        <Progress value={Math.max(0, Math.min(100, pct))} className="mt-3 h-1.5" />
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{category.description}</span>
          {category.na_excluded > 0 ? (
            <span className="inline-flex items-center gap-1">
              <CircleSlash className="size-3" aria-hidden />
              {category.na_excluded} rule{category.na_excluded === 1 ? "" : "s"} didn&apos;t
              apply — excluded from this category&apos;s total
            </span>
          ) : null}
          <span className="ml-auto underline-offset-2 hover:underline">
            {open ? "Hide" : "Show"} {category.items.length} rules
          </span>
        </div>
      </button>
      {open ? (
        <ul className="list-none">
          {items.map((item) => (
            <RuleRow key={item.id} item={item} />
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function ScrapeNotice({ audit }: { audit: StoredAudit["audit"] }) {
  const d = audit.diagnostics;
  const degraded =
    d.context_dev_markdown !== "ready" || d.context_dev_html !== "ready";
  if (!degraded && d.json_ld_parse_failures === 0) return null;
  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardContent className="flex gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="space-y-1 text-sm">
          <p className="font-medium">Read this score with the fetch in mind</p>
          <p className="text-muted-foreground">
            Markdown scrape: <span className="font-mono">{d.context_dev_markdown}</span>
            {" · "}
            HTML scrape: <span className="font-mono">{d.context_dev_html}</span>
            {d.json_ld_parse_failures > 0
              ? ` · ${d.json_ld_parse_failures} JSON-LD block(s) failed to parse`
              : ""}
            .{" "}
            {degraded
              ? "A partial fetch depresses structure and schema rules — a low score here may say more about the fetch than the page."
              : null}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function AuditResultView({ stored }: { stored: StoredAudit }) {
  const audit = stored.audit;
  const counts = React.useMemo(() => {
    const acc: Record<AuditStatus, number> = { pass: 0, partial: 0, fail: 0, na: 0 };
    for (const cat of audit.categories) for (const item of cat.items) acc[item.status] += 1;
    return acc;
  }, [audit.categories]);

  return (
    <div className="space-y-6">
      {/* The verdict. The score is the headline, so it is set at display
          scale in mono — and the four status counts sit beside it as peers
          rather than as a footnote, because "didn't apply" is a distinct
          outcome from "failed" and the scoring model depends on the reader
          understanding that. */}
      <div className="mb-10 border-b border-border pb-8">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  "font-mono text-7xl tabular-nums leading-none",
                  bandClass(audit.band.label),
                )}
              >
                {audit.score.toFixed(1)}
              </span>
              <span className="font-mono text-xl text-muted-foreground">/ 100</span>
            </div>
            <p className="mt-3 font-editorial text-2xl leading-tight text-foreground">
              {audit.band.label}
            </p>
            <p className="mt-1 max-w-(--measure) text-sm leading-relaxed text-muted-foreground">
              {audit.band.interpretation}
            </p>
            <div className="mt-4 space-y-0.5">
              <a
                className="break-all text-sm font-medium underline-offset-4 hover:underline"
                href={audit.url}
                rel="noreferrer noopener"
                target="_blank"
              >
                {audit.url}
              </a>
              {audit.title ? (
                <p className="truncate text-xs text-muted-foreground">{audit.title}</p>
              ) : null}
            </div>
            <Provenance
              className="mt-4"
              items={[
                {
                  label: "Fetched",
                  numeric: true,
                  value: new Date(audit.fetched_at).toLocaleString(),
                },
                { label: "Source", value: stored.cached ? "Cached" : "Live" },
              ]}
            />
          </div>

          <div className="grid shrink-0 grid-cols-4 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Pass" tone="positive" value={counts.pass} />
            <Metric label="Partial" value={counts.partial} />
            <Metric label="Fail" tone={counts.fail > 0 ? "negative" : "default"} value={counts.fail} />
            <Metric hint="Not applicable" label="N/A" tone="muted" value={counts.na} />
          </div>
        </div>
      </div>

      <ScrapeNotice audit={audit} />

      {/* Top priorities */}
      {audit.top_priorities.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Fix these first</CardTitle>
            <CardDescription>
              The highest-weight rules this page is losing points on.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2">
              {audit.top_priorities.map((p, i) => (
                <li key={`${i}-${p.slice(0, 24)}`} className="flex gap-3 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">{p}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}

      {/* Agent fix prompt */}
      {audit.agent_prompts.full ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Agent fix prompt</CardTitle>
            <CardDescription>
              Paste this into your coding agent. It describes every finding on this
              page, in the order it should be fixed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => void copyText(audit.agent_prompts.full, "Fix prompt")}
              >
                <Copy aria-hidden />
                Copy full prompt
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href={promptDownloadUrl(stored.id)} download>
                  <Download aria-hidden />
                  Download .txt
                </a>
              </Button>
            </div>
            <pre className="max-h-72 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed whitespace-pre-wrap break-words">
              {audit.agent_prompts.full}
            </pre>
            {audit.agent_prompts.top_issues.length > 0 ? (
              <>
                <Separator />
                <p className="text-xs text-muted-foreground">
                  Or take one issue at a time:
                </p>
                <ul className="space-y-2">
                  {audit.agent_prompts.top_issues.map((issue) => (
                    <li
                      key={issue.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 text-sm">
                        <code className="mr-2 font-mono text-[10px] uppercase text-muted-foreground">
                          {issue.id}
                        </code>
                        {issue.label}
                      </span>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => void copyText(issue.prompt, issue.label)}
                      >
                        <Copy aria-hidden />
                        Copy
                      </Button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Section
        aside={`${audit.categories.length} categories, 100 points`}
        label="Category breakdown"
      >
        <div className="space-y-3">
          {audit.categories.map((category) => (
            <CategoryCard category={category} key={category.id} />
          ))}
        </div>
      </Section>

      {/* What the rules actually saw. These are the inputs behind every
          verdict above, so they belong on the page — an audit you cannot
          check is just an opinion with a number on it. */}
      <Section label="What we parsed">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4 lg:grid-cols-7">
          <Metric label="Words" value={audit.stats.words.toLocaleString()} />
          <Metric label="Headings" value={audit.stats.headings.toLocaleString()} />
          <Metric label="Links" value={audit.stats.links.toLocaleString()} />
          <Metric label="External" value={audit.stats.external_links.toLocaleString()} />
          <Metric label="JSON-LD" value={audit.stats.json_ld_blocks.toLocaleString()} />
          <Metric label="MD chars" value={audit.stats.markdown_chars.toLocaleString()} />
          <Metric label="HTML chars" value={audit.stats.raw_html_chars.toLocaleString()} />
        </div>
      </Section>
    </div>
  );
}
