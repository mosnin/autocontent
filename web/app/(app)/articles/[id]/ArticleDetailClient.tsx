"use client";

// Article detail. Unlike the job detail page (a pure server component
// with a known staleness gap), this polls via SWR while the pipeline is
// still working so a "writing" page flips to "done" on its own.

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { ArrowLeft, Download, ImageIcon, RefreshCw } from "lucide-react";

import { ArticleMarkdown } from "@/components/article-markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { retryArticleAction } from "@/lib/actions";
import { clientFetch } from "@/lib/client-fetcher";
import { ARTICLE_IN_PROGRESS, ArticleStatusBadge } from "@/lib/status-badge";
import type { Article } from "@/lib/types";

const POLL_MS = 10_000;

// Recording-light pulse — reused verbatim from the design system for
// anything "live" / in-progress.
function RecordingDot() {
  return (
    <span aria-hidden className="relative flex size-2">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
      <span className="relative inline-flex size-2 rounded-full bg-brand" />
    </span>
  );
}

export function ArticleDetailClient({
  initial,
  nicheTitle,
}: {
  initial: Article;
  nicheTitle: string | null;
}) {
  const { data, mutate } = useSWR<Article>(
    `/api/v1/articles/${initial.id}`,
    clientFetch,
    {
      fallbackData: initial,
      // Poll while the pipeline is working; stop once terminal.
      refreshInterval: (latest) => {
        const status = (latest ?? initial).status;
        return status === "done" || status === "failed" ? 0 : POLL_MS;
      },
    },
  );

  const article = data ?? initial;
  const inProgress =
    article.status === "queued" || ARTICLE_IN_PROGRESS.has(article.status);
  const downloadPath = `/api/proxy/api/v1/articles/${article.id}/markdown`;

  const [retrying, setRetrying] = React.useState(false);
  async function handleRetry() {
    setRetrying(true);
    const fd = new FormData();
    fd.set("article_id", article.id);
    const res = await retryArticleAction({ ok: false }, fd);
    setRetrying(false);
    if (res.ok) {
      toast.success("Retry enqueued");
      void mutate();
    } else {
      toast.error(res.error ?? "Retry failed");
    }
  }

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/articles">
          <ArrowLeft className="h-4 w-4" />
          Back to articles
        </Link>
      </Button>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
            Article
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <ArticleStatusBadge status={article.status} />
            <code className="font-mono text-sm tabular-nums text-muted-foreground">
              {article.id}
            </code>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {article.title ?? article.topic}
          </h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {inProgress && (
              <span className="inline-flex items-center gap-1.5 font-medium text-brand">
                <RecordingDot />
                In progress — updates every {POLL_MS / 1000}s
              </span>
            )}
            {nicheTitle && <span>Niche: {nicheTitle}</span>}
            <span className="tabular-nums">
              Created: {new Date(article.created_at).toLocaleString()}
            </span>
            {article.word_count != null && (
              <span className="tabular-nums">
                {article.word_count.toLocaleString()} words
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {article.status === "failed" && (
            <Button
              variant="destructive"
              onClick={handleRetry}
              disabled={retrying}
            >
              <RefreshCw
                className={`h-4 w-4 ${retrying ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              {retrying ? "Retrying…" : "Retry"}
            </Button>
          )}
          {article.article_markdown && (
            <Button asChild variant="outline">
              <a
                href={downloadPath}
                download={`${article.slug ?? article.id}.md`}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Download .md
              </a>
            </Button>
          )}
        </div>
      </div>

      {article.status === "failed" && article.error && (
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {article.error}
        </pre>
      )}

      {article.hero_image_path && (
        <HeroImageCard articleId={article.id} alt={article.hero_image_alt} />
      )}

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Article body */}
        <Card className="min-w-0 lg:w-2/3">
          <CardHeader>
            <CardTitle className="text-base">Article</CardTitle>
          </CardHeader>
          <CardContent>
            {article.article_markdown ? (
              <ArticleMarkdown markdown={article.article_markdown} />
            ) : (
              <div className="rounded-lg border border-brand/20 bg-card/40 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <RecordingDot />
                  <span className="text-xs font-medium uppercase tracking-[0.2em] text-brand">
                    {article.status === "failed" ? "No draft" : "Writing"}
                  </span>
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {article.status === "failed"
                    ? "The pipeline failed before a draft was produced."
                    : "The article body appears here as soon as the writing step finishes."}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* SEO sidebar */}
        <div className="min-w-0 space-y-6 lg:w-1/3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">SEO metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <MetaRow label="Focus keyword">
                {article.focus_keyword || "—"}
              </MetaRow>
              <Separator />
              <MetaRow label="Slug">
                {article.slug ? (
                  <code className="break-all font-mono text-xs">
                    /{article.slug}
                  </code>
                ) : (
                  "—"
                )}
              </MetaRow>
              <Separator />
              <MetaRow
                label={`Meta description${
                  article.meta_description
                    ? ` · ${article.meta_description.length} chars`
                    : ""
                }`}
              >
                {article.meta_description ? (
                  <span className="text-muted-foreground">
                    {article.meta_description}
                  </span>
                ) : (
                  "—"
                )}
              </MetaRow>
              <Separator />
              <MetaRow label="Keywords">
                {article.keywords.length > 0 ? (
                  <span className="flex flex-wrap gap-1.5">
                    {article.keywords.map((k) => (
                      <Badge key={k} variant="outline" className="font-normal">
                        {k}
                      </Badge>
                    ))}
                  </span>
                ) : (
                  "—"
                )}
              </MetaRow>

              {article.quality && (
                <>
                  <Separator />
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Quality
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      <StatTile
                        label="Overall"
                        value={fmtScore(article.quality.overall)}
                      />
                      <StatTile
                        label="E-E-A-T"
                        value={fmtScore(article.quality.eeatScore)}
                      />
                      <StatTile
                        label="Readability"
                        value={fmtScore(article.quality.readability)}
                      />
                      <StatTile
                        label="Kw density"
                        value={fmtScore(article.quality.keywordDensity)}
                      />
                    </div>
                    {article.quality.notes.length > 0 && (
                      <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                        {article.quality.notes.map((note, i) => (
                          <li key={i}>{note}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {article.link_suggestions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Link suggestions</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 text-sm">
                  {article.link_suggestions.map((s, i) => (
                    <li key={i} className="rounded-md border p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium">{s.anchor}</span>
                        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                          {fmtScore(s.score)}
                        </span>
                      </div>
                      <a
                        href={s.targetUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 block break-all text-xs text-brand hover:underline"
                      >
                        {s.targetUrl}
                      </a>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {article.schema_jsonld && (
            <Card>
              <CardContent>
                <details>
                  <summary className="cursor-pointer text-sm font-medium">
                    JSON-LD schema
                  </summary>
                  <pre className="mt-3 max-h-80 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
                    {prettyJson(article.schema_jsonld)}
                  </pre>
                </details>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// The pipeline generates an editorial hero image on the artifacts volume;
// GET /api/v1/articles/{id}/hero-image streams it (ownership-scoped),
// proxied like the character sheet. Render it in its 16/10 editorial
// frame with the generated alt text; fall back to a labelled card if the
// bytes 404 (e.g. GC'd artifact).
function HeroImageCard({ articleId, alt }: { articleId: string; alt: string | null }) {
  const [errored, setErrored] = React.useState(false);
  const src = `/api/proxy/api/v1/articles/${articleId}/hero-image`;
  return (
    <Card className="overflow-hidden">
      {!errored ? (
        <div className="relative aspect-[16/10] w-full bg-muted/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt ?? "Generated hero image for this article"}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setErrored(true)}
          />
        </div>
      ) : (
        <CardContent className="flex items-start gap-4 p-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-card/40 text-muted-foreground">
            <ImageIcon className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">Hero image generated</p>
            <p className="text-sm text-muted-foreground">
              {alt ?? "A hero image was produced for this article."}
            </p>
          </div>
        </CardContent>
      )}
      {!errored && alt ? (
        <CardContent className="p-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">Alt text:</span> {alt}
          </p>
        </CardContent>
      ) : null}
    </Card>
  );
}

function MetaRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </h4>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-3">
      <div className="text-[0.65rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-xl font-semibold tabular-nums">
        {value}
      </div>
    </div>
  );
}

function fmtScore(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
