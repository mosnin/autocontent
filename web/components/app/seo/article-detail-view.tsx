"use client";

import { Download, FileText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AskPill, Button, buttonClass, Callout, Card, Chip, CodeBlock, Column, CopyButton, cx, EmptyLine, Facts, KpiCard, List, ListRow, Notice, PageHeader, Section, StatusBadge, Thumb } from "@/design-system";
import { retryArticleAction } from "@/lib/actions";
import { proxyFetch } from "@/lib/proxy-fetch";
import type { Article, Niche } from "@/lib/types";
import { LiveRefresh, StepList, Time, toolGlyph } from "../content/shared";
import { articleStatusLabel, articleTone, ARTICLE_IN_PROGRESS, ARTICLE_STEPS } from "../content/status";
import { ArticleBody } from "./article-body";
import { qaTone } from "./seo-view";

const SOCIAL = [
  { key: "twitter", label: "X" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
  { key: "newsletter", label: "Newsletter" },
] as const;
type Snippet = { platform: string; body: string; hashtags: string[] };

function prettyJson(raw: string) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

const num = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(1));

function Hero({ article, preview }: { article: Article; preview?: boolean }) {
  const [broken, setBroken] = useState(false);
  if (!article.hero_image_path) return null;
  return (
    <figure className="space-y-1.5">
      <Thumb ratio="16/9">
        {!broken && article.hero_image_path ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/proxy/api/v1/articles/${article.id}/hero-image`} alt={article.hero_image_alt ?? "Hero image for this article"} className="absolute inset-0 size-full object-cover" loading="lazy" onError={() => setBroken(true)} />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-fg-faint">
            <FileText className="size-5" />
          </span>
        )}
      </Thumb>
      {article.hero_image_alt && <figcaption className="text-[12px] text-fg-muted">Alt text: {article.hero_image_alt}</figcaption>}
    </figure>
  );
}

function Repurpose({ id }: { id: string }) {
  const [selected, setSelected] = useState<string[]>(["twitter", "linkedin"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snippets, setSnippets] = useState<Snippet[] | null>(null);
  const toggle = (k: string) => setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await proxyFetch<{ snippets: Snippet[] }>(`/api/v1/articles/${id}/social`, "POST", { platforms: selected });
      setSnippets(data.snippets);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't write the posts.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Repurpose to social">
      <Card className="space-y-3 px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Platforms">
          {SOCIAL.map((p) => (
            <Chip key={p.key} selected={selected.includes(p.key)} onClick={() => toggle(p.key)}>
              {p.label}
            </Chip>
          ))}
          <Button variant="primary" className="ml-auto" onClick={() => void go()} loading={busy} disabled={selected.length === 0}>
            Write the posts
          </Button>
        </div>
        <Notice error={error} />
        {snippets && snippets.length === 0 && <p className="text-[12.5px] text-fg-muted">Nothing came back for those platforms. Try a different mix.</p>}
      </Card>
      {snippets && snippets.length > 0 && (
        <List className="mt-3">
          {snippets.map((s, i) => {
            const full = s.body + (s.hashtags.length ? `\n\n${s.hashtags.join(" ")}` : "");
            return (
              <div key={`${s.platform}-${i}`} className="px-3.5 py-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <StatusBadge>{SOCIAL.find((p) => p.key === s.platform)?.label ?? s.platform}</StatusBadge>
                  <CopyButton text={full} />
                </div>
                <p className="whitespace-pre-wrap text-[13px]">{s.body}</p>
                {s.hashtags.length > 0 && <p className="mt-1 text-[12.5px] text-ds-accent">{s.hashtags.join(" ")}</p>}
              </div>
            );
          })}
        </List>
      )}
    </Section>
  );
}

/** Article detail (Detail template): facts, then the article as a clean reading column, then search data. */
export function ArticleDetailView({ article, niche, preview }: { article: Article; niche: Niche | null; preview?: boolean }) {
  const router = useRouter();
  const working = ARTICLE_IN_PROGRESS.has(article.status);
  const [retrying, setRetrying] = useState(false);
  const [retryMsg, setRetryMsg] = useState<string | null>(null);
  const title = article.title ?? article.topic;
  const stepIdx = ARTICLE_STEPS.findIndex((s) => s.id === article.status);
  const failedAt = article.article_markdown ? ARTICLE_STEPS.findIndex((s) => s.id === "qa") : ARTICLE_STEPS.findIndex((s) => s.id === "researching");
  const q = article.quality;
  const ask = article.status === "failed" ? `Why did the article "${title.slice(0, 60)}" fail, and can you fix it?` : `How do I get the article "${title.slice(0, 60)}" ranking faster?`;

  const retry = async () => {
    setRetrying(true);
    const fd = new FormData();
    fd.set("article_id", article.id);
    const res = await retryArticleAction({ ok: false }, fd);
    setRetrying(false);
    if (res.ok) router.refresh();
    else setRetryMsg(res.error ?? "Retry failed");
  };

  return (
    <>
      <LiveRefresh active={working && !preview} ms={10_000} />
      <PageHeader
        icon={toolGlyph("seo")}
        crumbs={[{ label: "SEO", href: "/seo" }, { label: title }]}
        actions={
          <>
            {article.article_markdown && (
              <a href={`/api/proxy/api/v1/articles/${article.id}/markdown`} download={`${article.slug ?? article.id}.md`} className={buttonClass("secondary", "md")} aria-label="Download markdown">
                <Download />
                <span className="hidden sm:inline">Markdown</span>
              </a>
            )}
            {article.status === "failed" && (
              <Button variant="primary" onClick={() => void retry()} loading={retrying}>
                Retry
              </Button>
            )}
          </>
        }
      />
      <Column
        width="md"
        title={title}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusBadge tone={articleTone(article.status)}>{articleStatusLabel(article.status)}</StatusBadge>
            <span>
              {article.word_count != null && `${article.word_count.toLocaleString("en-US")} words · `}
              <Time iso={article.created_at} />
            </span>
          </span>
        }
      >
        {(retryMsg || (article.status === "failed" && article.error)) && (
          <div className="space-y-2">
            <Notice error={retryMsg} />
            {article.status === "failed" && article.error && (
              <Callout tone="negative" title="Why it failed">
                <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{article.error}</span>
              </Callout>
            )}
          </div>
        )}

        <Facts
          items={[
            { label: "Playbook", value: niche ? <Link href={`/playbooks/${niche.id}`} className="text-ds-accent hover:underline">{niche.title}</Link> : "—" },
            { label: "Focus keyword", value: article.focus_keyword || "—" },
            { label: "Slug", value: article.slug ? <span className="font-mono text-[12px]">/{article.slug}</span> : "—" },
            { label: "QA score", value: <span className={cx("font-medium", qaTone(q?.overall))}>{num(q?.overall)}</span> },
            { label: "Created", value: <Time iso={article.created_at} mode="datetime" /> },
          ]}
        />

        <div className="space-y-6">
          <Hero article={article} preview={preview} />
          {article.article_markdown ? (
            <article>
              <ArticleBody markdown={article.article_markdown} />
            </article>
          ) : (
            <EmptyLine>{article.status === "failed" ? "The pipeline stopped before a draft was written." : "The article appears here once the writing step finishes."}</EmptyLine>
          )}
        </div>

        {article.status !== "done" && (
          <Section title="Pipeline">
            <Card className="px-3.5 py-3">
              <StepList steps={ARTICLE_STEPS} current={article.status === "failed" ? failedAt : Math.max(0, stepIdx)} failed={article.status === "failed"} />
            </Card>
          </Section>
        )}

        {q && (
          <Section title="Quality">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <KpiCard label="Overall" value={<span className={qaTone(q.overall)}>{num(q.overall)}</span>} />
              <KpiCard label="E-E-A-T" value={<span className={qaTone(q.eeatScore)}>{num(q.eeatScore)}</span>} />
              <KpiCard label="Readability" value={<span className={qaTone(q.readability)}>{num(q.readability)}</span>} />
              <KpiCard label="Keyword density" value={`${num(q.keywordDensity)}%`} />
            </div>
            {q.notes.length > 0 && (
              <List className="mt-3">
                {q.notes.map((n, i) => (
                  <ListRow key={i} className="min-h-10 text-[13px] text-fg-muted">
                    {n}
                  </ListRow>
                ))}
              </List>
            )}
          </Section>
        )}

        <Section title="Search metadata">
          <Card>
            <div className="space-y-1 px-3.5 py-3">
              <div className="flex items-baseline justify-between gap-2 text-[12px] text-fg-muted">
                <span>Meta description</span>
                {article.meta_description && <span className={cx("tabular", article.meta_description.length > 160 ? "text-attention" : "text-fg-faint")}>{article.meta_description.length}/160</span>}
              </div>
              <p className="text-[13px]">{article.meta_description || "—"}</p>
            </div>
            {article.title && (
              <div className="space-y-1 border-t border-hairline px-3.5 py-3">
                <div className="text-[12px] text-fg-muted">Title</div>
                <p className="text-[13px]">{article.title}</p>
              </div>
            )}
            {article.keywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-t border-hairline px-3.5 py-3">
                {article.keywords.map((k) => (
                  <StatusBadge key={k}>{k}</StatusBadge>
                ))}
              </div>
            )}
          </Card>
        </Section>

        {article.link_suggestions.length > 0 && (
          <Section title="Internal links">
            <List>
              {article.link_suggestions.map((s, i) => (
                <ListRow key={i}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{s.anchor}</div>
                    <a href={s.targetUrl} target="_blank" rel="noreferrer" className="block truncate text-[12px] text-ds-accent hover:underline">
                      {s.targetUrl}
                    </a>
                  </div>
                  <span className="shrink-0 text-[12px] text-fg-faint tabular">{s.score <= 1 ? `${Math.round(s.score * 100)}%` : s.score.toFixed(1)}</span>
                </ListRow>
              ))}
            </List>
          </Section>
        )}

        {article.schema_jsonld && (
          <Section title="JSON-LD">
            <CodeBlock code={prettyJson(article.schema_jsonld)} className="[&_pre]:max-h-64" />
          </Section>
        )}

        {article.status === "done" && article.article_markdown && <Repurpose id={article.id} />}

        <AskPill label="Ask about this article" href={`/sessions/new?dept=seo&q=${encodeURIComponent(ask)}`} />
      </Column>
    </>
  );
}
