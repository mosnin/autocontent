"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, cx, Field, FieldGroup, Input, Modal, Notice, TagInput, Textarea, usePending } from "@/design-system";
import { proxyFetch } from "@/lib/proxy-fetch";
import { META_DESCRIPTION_MAX, META_TITLE_MAX, type MetaDraft, type SeoArticle, slugify, validateMeta } from "@/lib/seo";

function Count({ n, max }: { n: number; max: number }) {
  return <span className={cx("tabular text-[12px] transition-colors duration-150", n > max ? "text-negative" : n > max - 10 ? "text-attention" : "text-fg-faint")}>{n}/{max}</span>;
}

/** A search-result preview: how the title, URL and description read in Google. */
export function SerpPreview({ title, description, url }: { title: string; description: string; url: string }) {
  return (
    <div className="space-y-0.5 rounded-ds-md border border-hairline bg-surface-2 px-3 py-2.5" aria-label="Search result preview">
      <div className="truncate text-[12px] text-fg-muted">{url}</div>
      <div className="line-clamp-1 text-[14px] text-ds-accent">{title || "Meta title"}</div>
      <div className="line-clamp-2 text-[12.5px] text-fg-muted">{description || "Meta description"}</div>
    </div>
  );
}

/** Edit search metadata: one focused sheet with live counts, inline validation and a search preview. */
export function SeoMetaEditor({ article, open, onClose, siteUrl }: { article: SeoArticle; open: boolean; onClose: () => void; siteUrl?: string | null }) {
  const router = useRouter();
  const initial: MetaDraft = {
    meta_title: article.meta_title ?? article.title ?? "",
    meta_description: article.meta_description ?? "",
    slug: article.slug ?? "",
    focus_keyword: article.focus_keyword ?? "",
    secondary_keywords: article.keywords ?? [],
  };
  const [d, setD] = useState<MetaDraft>(initial);
  const [touched, setTouched] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const { busy, error, run } = usePending<"save">();
  const errors = { ...validateMeta(d), ...serverErrors } as Partial<Record<keyof MetaDraft, string>>;
  const shown = (k: keyof MetaDraft) => (touched ? errors[k] : undefined);
  const set = <K extends keyof MetaDraft>(k: K, v: MetaDraft[K]) => {
    setD((p) => ({ ...p, [k]: v }));
    setServerErrors((p) => {
      const { [k]: _drop, ...rest } = p;
      return rest;
    });
  };
  const host = (siteUrl ?? "https://your-site.com").replace(/\/$/, "");

  const save = () => {
    setTouched(true);
    if (Object.keys(validateMeta(d)).length > 0) return;
    void run("save", async () => {
      try {
        await proxyFetch(`/api/v1/articles/${article.id}/seo`, "PATCH", d);
      } catch (e) {
        // A 422 carries per-field problems ({detail: {errors}}); the proxy hands back the raw body.
        const msg = e instanceof Error ? e.message : "";
        if (msg.startsWith("{")) {
          try {
            setServerErrors((JSON.parse(msg) as { detail?: { errors?: Record<string, string> } }).detail?.errors ?? {});
            setTouched(true);
            return;
          } catch {
            throw new Error("Check the fields above and try again.");
          }
        }
        throw e;
      }
      router.refresh();
      onClose();
    });
  };

  const err = (k: keyof MetaDraft) => shown(k) && <span className="block text-[12px] text-negative">{shown(k)}</span>;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Search metadata"
      width="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="seo-meta" variant="primary" loading={busy === "save"}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="seo-meta"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <SerpPreview title={d.meta_title} description={d.meta_description} url={`${host}/${d.slug}`} />
        <Field label="Meta title" hint={<span className="flex justify-between gap-2"><span>Shown as the search result's headline.</span><Count n={d.meta_title.trim().length} max={META_TITLE_MAX} /></span>}>
          <Input value={d.meta_title} onChange={(e) => set("meta_title", e.target.value)} aria-invalid={Boolean(shown("meta_title"))} autoFocus />
        </Field>
        {err("meta_title")}
        <Field label="Meta description" hint={<span className="flex justify-between gap-2"><span>One or two sentences that earn the click.</span><Count n={d.meta_description.trim().length} max={META_DESCRIPTION_MAX} /></span>}>
          <Textarea rows={3} value={d.meta_description} onChange={(e) => set("meta_description", e.target.value)} aria-invalid={Boolean(shown("meta_description"))} />
        </Field>
        {err("meta_description")}
        <Field label="Slug">
          <span className="flex items-center gap-2">
            <Input value={d.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} aria-invalid={Boolean(shown("slug"))} className="font-mono text-[12.5px]" />
            <Button size="md" variant="ghost" onClick={() => set("slug", slugify(d.meta_title))} disabled={!d.meta_title.trim()}>
              From title
            </Button>
          </span>
        </Field>
        {err("slug")}
        <Field label="Focus keyword">
          <Input value={d.focus_keyword} onChange={(e) => set("focus_keyword", e.target.value)} aria-invalid={Boolean(shown("focus_keyword"))} />
        </Field>
        {err("focus_keyword")}
        <FieldGroup label="Secondary keywords" hint="Up to 10. Press Enter after each.">
          <TagInput id="seo-secondary" values={d.secondary_keywords} onChange={(v) => set("secondary_keywords", v)} placeholder="Add a keyword" />
        </FieldGroup>
        {err("secondary_keywords")}
        <Notice error={error} />
      </form>
    </Modal>
  );
}
