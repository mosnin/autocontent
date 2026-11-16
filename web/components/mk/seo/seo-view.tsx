"use client";

import { FileText, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { retryArticleAction } from "@/lib/actions";
import { departmentById } from "@/lib/departments";
import type { Article, Niche } from "@/lib/types";
import { StartSession } from "../agent/start-session";
import { List, PageBody, PageHeader, PageIntro, Stat } from "../page";
import { Button, ButtonLink, Chip, cx, Empty, IconTile, Input } from "../ui";
import { StatusWord, Time, useLiveRefresh } from "../content/bits";
import { articleDot, articleStatusLabel, articleTone, ARTICLE_IN_PROGRESS } from "../content/status";
import { WriteDialog } from "./write-dialog";

type Filter = "all" | "in_progress" | "done" | "failed";
const FILTERS: { value: Filter; label: string; match: (a: Article) => boolean }[] = [
  { value: "all", label: "All", match: () => true },
  { value: "in_progress", label: "In progress", match: (a) => ARTICLE_IN_PROGRESS.has(a.status) },
  { value: "done", label: "Ready", match: (a) => a.status === "done" },
  { value: "failed", label: "Failed", match: (a) => a.status === "failed" },
];

export function qaTone(score: number | null | undefined) {
  if (score == null) return "text-faint";
  return score >= 85 ? "text-floor" : score >= 70 ? "text-foreground" : "text-queued";
}

function RetryArticle({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return msg === "ok" ? (
    <span className="text-[13px] text-muted-foreground">Retrying</span>
  ) : (
    <span className="flex items-center gap-2">
      {msg && <span className="text-[12px] text-destructive">{msg}</span>}
      <Button
        size="sm"
        loading={busy}
        onClick={async (e) => {
          e.preventDefault();
          setBusy(true);
          const fd = new FormData();
          fd.set("article_id", id);
          const res = await retryArticleAction({ ok: false }, fd);
          setBusy(false);
          if (res.ok) {
            setMsg("ok");
            router.refresh();
          } else setMsg(res.error ?? "Retry failed");
        }}
      >
        Retry
      </Button>
    </span>
  );
}

function ArticleRow({ a, playbook }: { a: Article; playbook?: string }) {
  const score = a.quality?.overall;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <IconTile>
        <FileText />
      </IconTile>
      <Link href={`/seo/${a.id}`} className="min-w-0 flex-1 basis-[220px]">
        <div className={cx("truncate text-[14px] font-medium", !a.title && "text-muted-foreground")}>{a.title ?? a.topic}</div>
        <div className="truncate text-[13px] text-muted-foreground">
          {playbook ? `${playbook} · ` : ""}
          {a.focus_keyword && <span>“{a.focus_keyword}”</span>}
          {a.word_count != null && <span className="tabular"> · {a.word_count.toLocaleString("en-US")} words</span>}
          <span className="text-faint">
            {" · "}
            <Time iso={a.created_at} />
          </span>
        </div>
        {a.status === "failed" && a.error && <div className="mt-0.5 line-clamp-2 text-[12px] text-destructive">{a.error}</div>}
      </Link>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        {score != null && (
          <span className="text-right" title="QA score">
            <span className={cx("text-[14px] font-medium tabular", qaTone(score))}>{Math.round(score)}</span>
            <span className="ml-1 text-[12px] text-faint">QA</span>
          </span>
        )}
        <StatusWord label={articleStatusLabel(a.status)} tone={articleTone(a.status)} dot={articleDot(a.status)} />
        {a.status === "failed" && <RetryArticle id={a.id} />}
      </div>
    </div>
  );
}

export function SeoView({ articles, niches, openNew, preview }: { articles: Article[] | null; niches: Niche[]; openNew?: boolean; preview?: boolean }) {
  const dept = departmentById("seo")!;
  const [write, setWrite] = useState(Boolean(openNew));
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const titles = useMemo(() => new Map(niches.map((n) => [n.id, n.title])), [niches]);
  const list = articles ?? [];
  useLiveRefresh(list.some((a) => ARTICLE_IN_PROGRESS.has(a.status)) && !preview, 10_000);

  const f = FILTERS.find((x) => x.value === filter)!;
  const needle = q.trim().toLowerCase();
  const visible = list.filter((a) => f.match(a) && (!needle || [a.title ?? "", a.topic, a.focus_keyword, titles.get(a.niche_id) ?? ""].some((s) => s.toLowerCase().includes(needle))));

  const ready = list.filter((a) => a.status === "done");
  const scored = ready.filter((a) => a.quality);
  const avgQa = scored.length ? scored.reduce((s, a) => s + (a.quality?.overall ?? 0), 0) / scored.length : null;
  const words = ready.reduce((s, a) => s + (a.word_count ?? 0), 0);

  return (
    <>
      <PageHeader icon={<FileText />} title="SEO">
        <Button variant="primary" size="sm" onClick={() => setWrite(true)}>
          Write an article
        </Button>
      </PageHeader>
      <PageBody width="5xl">
        <PageIntro title="SEO">{dept.summary}</PageIntro>
        <div className="t-stagger space-y-8">
          <StartSession scope="seo" lockScope suggestions={dept.asks} />

          {list.length > 0 && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Articles ready" value={ready.length} />
              <Stat label="Being written" value={list.filter((a) => ARTICLE_IN_PROGRESS.has(a.status)).length} />
              <Stat label="Average QA" value={<span className={qaTone(avgQa)}>{avgQa != null ? Math.round(avgQa) : "—"}</span>} />
              <Stat label="Words published" value={words.toLocaleString("en-US")} />
            </div>
          )}

          <section className="space-y-3">
            {articles === null ? (
              <Empty art="activity" title="Couldn't load articles">The API didn't answer. Try again in a moment.</Empty>
            ) : list.length === 0 ? (
              niches.length === 0 ? (
                <Empty art="notes" title="Start with a playbook" action={<ButtonLink href="/playbooks/new" variant="primary">Create a playbook</ButtonLink>}>
                  The SEO editor writes for a playbook's audience and voice.
                </Empty>
              ) : (
                <Empty art="notes" title="No articles yet" action={<Button variant="primary" onClick={() => setWrite(true)}>Write an article</Button>}>
                  Long-form pieces researched against what ranks, scored for quality, ready to publish or repurpose.
                </Empty>
              )
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  {FILTERS.map((x) => (
                    <Chip key={x.value} selected={filter === x.value} onClick={() => setFilter(x.value)}>
                      {x.label}
                      <span className="tabular text-faint">{list.filter(x.match).length}</span>
                    </Chip>
                  ))}
                </div>
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, keywords, playbooks" aria-label="Search articles" className="pl-9" />
                </label>
                {visible.length === 0 ? (
                  <p className="rounded-[14px] bg-subtle px-4 py-5 text-[13px] text-muted-foreground">No articles match. Try another filter.</p>
                ) : (
                  <List>
                    {visible.map((a) => (
                      <ArticleRow key={a.id} a={a} playbook={titles.get(a.niche_id)} />
                    ))}
                  </List>
                )}
              </>
            )}
          </section>
        </div>
      </PageBody>
      <WriteDialog open={write} onClose={() => setWrite(false)} niches={niches} />
    </>
  );
}
