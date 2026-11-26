"use client";

import { ImagePlus } from "lucide-react";
import { useState } from "react";
import { Button, Card, cx, Section, StatusBadge, useAllowed } from "@/design-system";
import { META_DESCRIPTION_MAX, META_TITLE_MAX, type SeoArticle, type UnsplashPhoto, type WordPressConnection, httpsOnly } from "@/lib/seo";
import { CoverImage, CoverPicker } from "./cover-picker";
import { PublishPanel } from "./publish-panel";
import { SeoMetaEditor, SerpPreview } from "./seo-meta-editor";

function Row({ label, value, count, max }: { label: string; value: React.ReactNode; count?: number; max?: number }) {
  return (
    <div className="space-y-0.5 px-3.5 py-2.5">
      <div className="flex items-baseline justify-between gap-2 text-[12px] text-fg-muted">
        <span>{label}</span>
        {count != null && max != null && <span className={cx("tabular", count > max ? "text-negative" : "text-fg-faint")}>{count}/{max}</span>}
      </div>
      <div className="text-[13px] [overflow-wrap:anywhere]">{value}</div>
    </div>
  );
}

/** Search metadata as a read view with one Edit action; editing happens in its own sheet. */
function SearchMetadata({ article, siteUrl }: { article: SeoArticle; siteUrl: string | null }) {
  const canEdit = useAllowed("content:update");
  const [editing, setEditing] = useState(false);
  const title = article.meta_title ?? article.title ?? "";
  const desc = article.meta_description ?? "";
  return (
    <Section
      title="Search metadata"
      action={
        canEdit && article.status === "done" ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-3">
        <SerpPreview title={title} description={desc} url={`${(siteUrl ?? "https://your-site.com").replace(/\/$/, "")}/${article.slug ?? ""}`} />
        <Card className="divide-y divide-hairline">
          <Row label="Meta title" value={title || "—"} count={title.length} max={META_TITLE_MAX} />
          <Row label="Meta description" value={desc || "—"} count={desc.length} max={META_DESCRIPTION_MAX} />
          <Row label="Focus keyword" value={article.focus_keyword || "—"} />
          {article.keywords.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3.5 py-2.5">
              {article.keywords.map((k) => (
                <StatusBadge key={k}>{k}</StatusBadge>
              ))}
            </div>
          )}
        </Card>
      </div>
      {editing && <SeoMetaEditor article={article} siteUrl={siteUrl} open onClose={() => setEditing(false)} />}
    </Section>
  );
}

/** Where the research came from: cited sources, read-only. */
function Sources({ article }: { article: SeoArticle }) {
  const sources = article.research?.sources ?? [];
  if (sources.length === 0) return null;
  return (
    <Section title={`Sources · ${sources.length}`}>
      <ol className="divide-y divide-hairline overflow-hidden rounded-ds-lg border border-hairline bg-surface">
        {sources.map((s, i) => {
          const href = httpsOnly(s.url);
          return (
            <li key={s.url} className="flex gap-3 px-3.5 py-2.5">
              <span className="w-4 shrink-0 pt-px text-right text-[12px] text-fg-faint tabular">{i + 1}</span>
              <div className="min-w-0 flex-1">
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="line-clamp-1 text-[13px] font-medium hover:underline">
                    {s.title || s.domain}
                  </a>
                ) : (
                  <span className="line-clamp-1 text-[13px] font-medium">{s.title || s.domain}</span>
                )}
                <span className="block truncate text-[12px] text-fg-muted">{s.domain}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

/** Cover: the credited photo, or one quiet way to add one. */
function Cover({ article, fixture }: { article: SeoArticle; fixture?: UnsplashPhoto[] }) {
  const canEdit = useAllowed("content:update");
  const [open, setOpen] = useState(false);
  if (article.status !== "done") return null;
  const cover = article.cover_image;
  return (
    <>
      {cover ? (
        <CoverImage
          cover={cover}
          action={
            canEdit ? (
              <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
                Change cover
              </Button>
            ) : undefined
          }
        />
      ) : canEdit ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ds-press flex w-full items-center justify-center gap-2 rounded-ds-lg border border-dashed border-hairline-strong px-4 py-5 text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg active:scale-[0.99]"
        >
          <ImagePlus className="size-4" /> Add a cover photo
        </button>
      ) : null}
      {open && <CoverPicker article={article} open onClose={() => setOpen(false)} fixture={fixture} />}
    </>
  );
}

/** The SEO pieces of the article page, placed by the detail view: cover, publishing, search metadata, sources. */
export function seoParts({ article, wordpress, coverFixture }: { article: SeoArticle; wordpress: WordPressConnection | null; coverFixture?: UnsplashPhoto[] }) {
  return {
    cover: <Cover article={article} fixture={coverFixture} />,
    publishing: <PublishPanel article={article} wordpress={wordpress} />,
    metadata: <SearchMetadata article={article} siteUrl={wordpress?.site_url ?? null} />,
    sources: <Sources article={article} />,
  };
}
