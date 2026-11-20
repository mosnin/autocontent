"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, ButtonLink, Column, cx, EmptyLine, Input, PageHeader, Section, Segmented, StatusBadge, Table, StatLine, Time, ToolTitle, Notice } from "@/design-system";
import { TOOL_ICON } from "@/components/shell/sidebar";
import { StartSession } from "@/components/chat/start-session";
import { retryArticleAction } from "@/lib/actions";
import type { Article, Niche } from "@/lib/types";
import { LiveRefresh, toolGlyph } from "../content/shared";
import { articleStatusLabel, articleTone, ARTICLE_IN_PROGRESS } from "../content/status";
import { WriteDialog } from "./write-dialog";

type Filter = "all" | "in_progress" | "done" | "failed";
const FILTERS: { value: Filter; label: string; match: (a: Article) => boolean }[] = [
  { value: "all", label: "All", match: () => true },
  { value: "in_progress", label: "In progress", match: (a) => ARTICLE_IN_PROGRESS.has(a.status) },
  { value: "done", label: "Ready", match: (a) => a.status === "done" },
  { value: "failed", label: "Failed", match: (a) => a.status === "failed" },
];

/** QA score colour: 85+ green, under 70 orange. */
export function qaTone(score: number | null | undefined) {
  if (score == null) return "text-fg-faint";
  return score >= 85 ? "text-positive" : score >= 70 ? "text-fg" : "text-attention";
}

function RetryArticle({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (msg === "ok") return <span className="text-[12.5px] text-fg-muted">Retrying</span>;
  return (
    <span className="relative z-10 flex items-center gap-2">
      {msg && <Notice inline error={msg} />}
      <Button
        size="sm"
        loading={busy}
        onClick={async () => {
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

/** SEO (Tool template): scoped composer, the article pipeline's numbers, then every article in one table. */
export function SeoView({ articles, niches, openNew, preview }: { articles: Article[] | null; niches: Niche[]; openNew?: boolean; preview?: boolean }) {
  const [write, setWrite] = useState(Boolean(openNew));
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const titles = useMemo(() => new Map(niches.map((n) => [n.id, n.title])), [niches]);
  const list = articles ?? [];

  const f = FILTERS.find((x) => x.value === filter)!;
  const needle = q.trim().toLowerCase();
  const visible = list.filter((a) => f.match(a) && (!needle || [a.title ?? "", a.topic, a.focus_keyword, titles.get(a.niche_id) ?? ""].some((s) => s.toLowerCase().includes(needle))));

  const ready = list.filter((a) => a.status === "done");
  const scored = ready.filter((a) => a.quality);
  const avgQa = scored.length ? scored.reduce((s, a) => s + (a.quality?.overall ?? 0), 0) / scored.length : null;
  const words = ready.reduce((s, a) => s + (a.word_count ?? 0), 0);
  const writing = list.filter((a) => ARTICLE_IN_PROGRESS.has(a.status)).length;

  return (
    <>
      <LiveRefresh active={writing > 0 && !preview} ms={10_000} />
      <PageHeader
        icon={toolGlyph("seo")}
        title="SEO"
        actions={
          <Button variant="primary" onClick={() => setWrite(true)}>
            Write an article
          </Button>
        }
      />
      <Column
        width="lg"
        title={<ToolTitle icon={TOOL_ICON.seo.icon} tone={TOOL_ICON.seo.tone}>SEO</ToolTitle>}
        description="Long-form articles researched against what ranks."
        control={
          list.length > 0 ? (
            <Segmented
              value={filter}
              onChange={setFilter}
              label="Article status"
              options={FILTERS.map((x) => ({
                value: x.value,
                label: (
                  <>
                    {x.label} <span className="text-fg-faint tabular">{list.filter(x.match).length}</span>
                  </>
                ),
              }))}
            />
          ) : undefined
        }
      >
        <div className="space-y-4">
          <StartSession scope="seo" lockScope />
          {list.length > 0 && (
            <StatLine
              items={[
                { label: "ready", value: ready.length },
                { label: "being written", value: writing },
                { label: "average QA", value: <span className={qaTone(avgQa)}>{avgQa != null ? Math.round(avgQa) : "—"}</span> },
                { label: "words ready", value: words.toLocaleString("en-US") },
              ]}
            />
          )}
        </div>

        <Section title="Articles">
          {articles === null ? (
            <EmptyLine>Couldn&apos;t load articles. Try again in a moment.</EmptyLine>
          ) : list.length === 0 ? (
            niches.length === 0 ? (
              <EmptyLine
                action={
                  <ButtonLink href="/playbooks/new" variant="primary">
                    Create a playbook
                  </ButtonLink>
                }
              >
                Articles are written for a playbook. Start with one.
              </EmptyLine>
            ) : (
              <EmptyLine
                action={
                  <Button variant="primary" onClick={() => setWrite(true)}>
                    Write an article
                  </Button>
                }
              >
                No articles yet.
              </EmptyLine>
            )
          ) : (
            <div className="space-y-2">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-faint" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, keywords, playbooks" aria-label="Search articles" className="pl-8" />
              </label>
              <Table
                rows={visible}
                rowKey={(a) => a.id}
                rowHref={(a) => `/seo/${a.id}`}
                empty={<EmptyLine>No articles match. Try another filter.</EmptyLine>}
                columns={[
                  {
                    key: "title",
                    label: "Article",
                    render: (a) => (
                      <span className="block min-w-0 py-1.5">
                        <span className={cx("line-clamp-1 font-medium", !a.title && "text-fg-muted")}>{a.title ?? a.topic}</span>
                        <span className="line-clamp-1 text-[12px] text-fg-muted">
                          {titles.get(a.niche_id) ?? "Playbook"}
                          {a.focus_keyword && ` · “${a.focus_keyword}”`}
                        </span>
                        {a.status === "failed" && a.error && <span className="line-clamp-1 text-[12px] text-negative">{a.error}</span>}
                        <span className="mt-1 flex md:hidden">
                          <StatusBadge tone={articleTone(a.status)}>{articleStatusLabel(a.status)}</StatusBadge>
                        </span>
                      </span>
                    ),
                  },
                  { key: "words", label: "Words", align: "right", hideOnPhone: true, width: "84px", render: (a) => (a.word_count != null ? a.word_count.toLocaleString("en-US") : <span className="text-fg-faint">—</span>) },
                  { key: "qa", label: "QA", align: "right", width: "56px", render: (a) => <span className={cx("font-medium", qaTone(a.quality?.overall))}>{a.quality?.overall != null ? Math.round(a.quality.overall) : "—"}</span> },
                  {
                    key: "status",
                    label: "Status",
                    width: "150px",
                    hideOnPhone: true,
                    render: (a) => (
                      <span className="flex items-center gap-2">
                        <StatusBadge tone={articleTone(a.status)}>{articleStatusLabel(a.status)}</StatusBadge>
                        {a.status === "failed" && <RetryArticle id={a.id} />}
                      </span>
                    ),
                  },
                  { key: "created", label: "Created", align: "right", width: "124px", hideOnPhone: true, render: (a) => <Time iso={a.created_at} className="whitespace-nowrap text-fg-muted" /> },
                ]}
              />
            </div>
          )}
        </Section>
      </Column>
      <WriteDialog open={write} onClose={() => setWrite(false)} niches={niches} />
    </>
  );
}
