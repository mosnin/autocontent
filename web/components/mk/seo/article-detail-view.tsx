"use client";

import { Check, Copy, Download, FileText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { retryArticleAction } from "@/lib/actions";
import type { Article, Niche } from "@/lib/types";
import { StartSession } from "../agent/start-session";
import { Crumbs, PageBody, PageHeader, PageIntro, Panel } from "../page";
import { Badge, Button, buttonCls, Chip, cx, Dot } from "../ui";
import { Meta, Note, postProxy, StatusWord, StepList, Time, useLiveRefresh } from "../content/bits";
import { articleDot, articleStatusLabel, articleTone, ARTICLE_IN_PROGRESS, ARTICLE_STEPS } from "../content/status";
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

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {ok ? <Check /> : <Copy />}
      {ok ? "Copied" : label}
    </Button>
  );
}

function Score({ label, value, hint }: { label: string; value: number | null | undefined; hint?: string }) {
  const shown = value == null || !Number.isFinite(value) ? "—" : Number.isInteger(value) ? String(value) : value.toFixed(1);
  return (
    <div className="min-w-0 rounded-[14px] border border-border bg-card px-3.5 py-3">
      <div className="truncate text-[13px] text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={cx("text-[22px] font-medium tracking-[-0.02em] tabular", hint === "%" ? undefined : qaTone(value))}>{shown}</span>
        {hint && <span className="text-[12px] text-faint">{hint}</span>}
      </div>
    </div>
  );
}

function Hero({ article, preview }: { article: Article; preview?: boolean }) {
  const [broken, setBroken] = useState(false);
  if (!article.hero_image_path && !preview) return null;
  return (
    <figure className="overflow-hidden rounded-[20px] border border-border bg-muted">
      {!broken && article.hero_image_path ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/proxy/api/v1/articles/${article.id}/hero-image`} alt={article.hero_image_alt ?? "Hero image for this article"} className="aspect-[16/9] w-full object-cover" loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <div className="flex aspect-[16/9] w-full items-center justify-center bg-gradient-to-br from-sky/20 via-muted to-muted text-faint">
          <FileText className="size-8 stroke-[1.3]" />
        </div>
      )}
      {article.hero_image_alt && <figcaption className="border-t border-border bg-card px-4 py-2.5 text-[13px] text-muted-foreground">Alt text: {article.hero_image_alt}</figcaption>}
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
      const data = (await postProxy(`/api/v1/articles/${id}/social`, { platforms: selected })) as { snippets: Snippet[] };
      setSnippets(data.snippets);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't write the posts.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel label="Repurpose to social">
      <p className="text-[13px] text-muted-foreground">Turn this article into platform-native posts. One metered generation against the playbook's cap.</p>
      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Platforms">
        {SOCIAL.map((p) => (
          <Chip key={p.key} selected={selected.includes(p.key)} onClick={() => toggle(p.key)}>
            {p.label}
          </Chip>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button variant="primary" size="sm" onClick={() => void go()} loading={busy} disabled={selected.length === 0}>
          Write the posts
        </Button>
        <Note tone="danger">{error}</Note>
      </div>
      {snippets && snippets.length === 0 && <p className="mt-3 text-[13px] text-muted-foreground">Nothing came back for those platforms. Try a different mix.</p>}
      {snippets && snippets.length > 0 && (
        <ul className="mt-4 divide-y divide-border border-t border-border">
          {snippets.map((s, i) => {
            const full = s.body + (s.hashtags.length ? `\n\n${s.hashtags.join(" ")}` : "");
            return (
              <li key={`${s.platform}-${i}`} className="py-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <Badge>{SOCIAL.find((p) => p.key === s.platform)?.label ?? s.platform}</Badge>
                  <CopyButton text={full} />
                </div>
                <p className="whitespace-pre-wrap text-[14px]">{s.body}</p>
                {s.hashtags.length > 0 && <p className="mt-1 text-[13px] text-accent">{s.hashtags.join(" ")}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function ArticleDetailView({ article, niche, preview }: { article: Article; niche: Niche | null; preview?: boolean }) {
  const router = useRouter();
  const working = ARTICLE_IN_PROGRESS.has(article.status);
  useLiveRefresh(working && !preview, 10_000);
  const [retrying, setRetrying] = useState(false);
  const [retryMsg, setRetryMsg] = useState<string | null>(null);
  const title = article.title ?? article.topic;
  const stepIdx = ARTICLE_STEPS.findIndex((s) => s.id === article.status);
  const failedAt = article.article_markdown ? ARTICLE_STEPS.findIndex((s) => s.id === "qa") : ARTICLE_STEPS.findIndex((s) => s.id === "researching");
  const q = article.quality;

  const retry = async () => {
    setRetrying(true);
    const fd = new FormData();
    fd.set("article_id", article.id);
    const res = await retryArticleAction({ ok: false }, fd);
    setRetrying(false);
    if (res.ok) router.refresh();
    else setRetryMsg(res.error ?? "Retry failed");
  };

  const asks = [
    article.status === "failed" ? "Why did this article fail, and can you fix it?" : "How do I get this article ranking faster?",
    "Write a follow-up article for the same cluster",
    "Turn this article into three short videos",
  ];

  return (
    <>
      <PageHeader icon={<FileText />} title={<Crumbs items={[<Link key="s" href="/seo" className="hover:text-foreground">SEO</Link>, title]} />}>
        {article.status === "failed" && (
          <Button size="sm" variant="primary" onClick={() => void retry()} loading={retrying}>
            Retry
          </Button>
        )}
        {article.article_markdown && (
          <a href={`/api/proxy/api/v1/articles/${article.id}/markdown`} download={`${article.slug ?? article.id}.md`} className={buttonCls("secondary", "sm")}>
            <Download />
            <span className="hidden sm:inline">Markdown</span>
          </a>
        )}
      </PageHeader>
      <PageBody width="6xl">
        <PageIntro title={title}>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusWord label={articleStatusLabel(article.status)} tone={articleTone(article.status)} dot={articleDot(article.status)} />
            <span>
              {niche ? (
                <Link href={`/playbooks/${niche.id}`} className="hover:text-foreground">
                  {niche.title}
                </Link>
              ) : (
                "Playbook"
              )}
              {article.word_count != null && <span className="tabular"> · {article.word_count.toLocaleString("en-US")} words</span>}
              {" · "}
              <Time iso={article.created_at} />
            </span>
          </span>
        </PageIntro>
        <Note tone="danger">{retryMsg}</Note>

        <div className="t-stagger grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-6">
            {article.status === "failed" && article.error && (
              <div role="alert" className="rounded-[14px] border border-destructive/25 bg-destructive/[0.06] px-4 py-3">
                <div className="text-[13px] font-medium text-destructive">Why it failed</div>
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-foreground/80 [overflow-wrap:anywhere]">{article.error}</p>
              </div>
            )}
            <Hero article={article} preview={preview} />
            <article className="rounded-[20px] border border-border bg-card px-5 py-6 sm:px-8 sm:py-8">
              {article.article_markdown ? (
                <ArticleBody markdown={article.article_markdown} />
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-[14px] font-medium">
                    {working && <Dot tone="live" />}
                    <span className={working ? "t-shimmer" : undefined}>{article.status === "failed" ? "No draft" : "Writing"}</span>
                  </div>
                  {working && (
                    <div aria-hidden className="space-y-2.5">
                      {[78, 100, 92, 64].map((w, i) => (
                        <div key={i} className="h-3 rounded-full bg-muted" style={{ width: `${w}%` }} />
                      ))}
                    </div>
                  )}
                  <p className="text-[13px] text-muted-foreground">{article.status === "failed" ? "The pipeline stopped before a draft was written." : "The article appears here as soon as the writing step finishes."}</p>
                </div>
              )}
            </article>
            {article.status === "done" && article.article_markdown && <Repurpose id={article.id} />}
            <section>
              <h2 className="mb-2.5 text-[13px] text-muted-foreground">Ask the SEO editor about this article</h2>
              <StartSession scope="seo" lockScope suggestions={asks} />
            </section>
          </div>

          <aside className="min-w-0 space-y-4">
            {article.status !== "done" && (
              <Panel label="Pipeline" action={working ? <span className="text-[12px] text-muted-foreground">Updates live</span> : undefined}>
                <StepList steps={ARTICLE_STEPS} current={article.status === "failed" ? failedAt : Math.max(0, stepIdx)} failed={article.status === "failed"} />
              </Panel>
            )}

            {q && (
              <Panel label="Quality">
                <div className="grid grid-cols-2 gap-2">
                  <Score label="Overall" value={q.overall} />
                  <Score label="E-E-A-T" value={q.eeatScore} />
                  <Score label="Readability" value={q.readability} />
                  <Score label="Keyword density" value={q.keywordDensity} hint="%" />
                </div>
                {q.notes.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {q.notes.map((n, i) => (
                      <li key={i} className="flex gap-2 text-[13px] text-muted-foreground">
                        <span className="mt-[7px] size-1 shrink-0 rounded-full bg-faint" aria-hidden />
                        {n}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}

            <Panel label="Search metadata">
              <Meta
                items={[
                  { label: "Focus keyword", value: article.focus_keyword || "—" },
                  { label: "Slug", value: article.slug ? <span className="font-mono text-[12px]">/{article.slug}</span> : "—" },
                  ...(article.title ? [{ label: "Title", value: <span className="text-left">{article.title}</span> }] : []),
                ]}
              />
              <div className="mt-3 border-t border-border pt-3">
                <div className="flex items-baseline justify-between gap-2 text-[13px] text-muted-foreground">
                  <span>Meta description</span>
                  {article.meta_description ? (
                    <span className={cx("tabular", article.meta_description.length > 160 ? "text-queued" : "text-faint")}>{article.meta_description.length}/160</span>
                  ) : null}
                </div>
                <p className="mt-1 text-[14px]">{article.meta_description || "—"}</p>
              </div>
              {article.keywords.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
                  {article.keywords.map((k) => (
                    <Badge key={k}>{k}</Badge>
                  ))}
                </div>
              )}
            </Panel>

            {article.link_suggestions.length > 0 && (
              <Panel label="Internal links">
                <ul className="divide-y divide-border">
                  {article.link_suggestions.map((s, i) => (
                    <li key={i} className="py-2.5 first:pt-0 last:pb-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[14px] font-medium">{s.anchor}</span>
                        <span className="shrink-0 text-[12px] text-faint tabular">{s.score <= 1 ? `${Math.round(s.score * 100)}%` : s.score.toFixed(1)}</span>
                      </div>
                      <a href={s.targetUrl} target="_blank" rel="noreferrer" className="block truncate text-[13px] text-accent hover:underline">
                        {s.targetUrl}
                      </a>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {article.schema_jsonld && (
              <Panel label="JSON-LD" action={<CopyButton text={prettyJson(article.schema_jsonld)} />}>
                <pre className="max-h-64 overflow-auto font-mono text-[12px] leading-relaxed text-muted-foreground">{prettyJson(article.schema_jsonld)}</pre>
              </Panel>
            )}
          </aside>
        </div>
      </PageBody>
    </>
  );
}
