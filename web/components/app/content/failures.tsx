"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Chip, List, ListRow, LoadMore, Notice, Section, StatusBadge, Time, usePaged } from "@/design-system";
import { proxyFetch } from "@/lib/proxy-fetch";
import type { FailureCategory, FailureItem, Failures } from "./types";

const CATEGORY: Record<FailureCategory, string> = {
  spend_cap: "Spend cap",
  provider_error: "Provider error",
  timeout_stuck: "Timed out",
  render_qa: "Render QA",
  content_qa: "Content QA",
  other: "Other",
};
const ORDER: FailureCategory[] = ["spend_cap", "provider_error", "timeout_stuck", "render_qa", "content_qa", "other"];
const KIND = { job: "Video", image_post: "Carousel", article: "Article" } as const;
const href = (f: FailureItem) => (f.kind === "job" ? `/content/videos/${f.id}` : f.kind === "article" ? `/seo/${f.id}` : "/content?tab=carousels");

function FailureRow({ f }: { f: FailureItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const replay = async () => {
    setBusy(true);
    setError(null);
    try {
      await proxyFetch(`/api/v1/failures/replay/${f.kind}/${f.id}`, "POST");
      setDone(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ListRow className="flex-wrap gap-y-1.5">
      <Link href={href(f)} className="min-w-0 flex-1 basis-[220px]">
        <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="font-medium">{KIND[f.kind]}</span>
          <StatusBadge tone={f.category === "spend_cap" || f.category === "provider_error" ? "negative" : "neutral"}>{CATEGORY[f.category]}</StatusBadge>
          {f.niche_title && <span className="text-fg-muted">{f.niche_title}</span>}
          <Time iso={f.created_at} className="text-[12px] text-fg-faint" />
        </div>
        <p className="mt-0.5 line-clamp-2 text-[12.5px] text-fg-muted">{f.error ?? "No error message was recorded."}</p>
        {error && <Notice error={error} />}
      </Link>
      {done ? (
        <span className="text-[12.5px] text-fg-muted">Retrying</span>
      ) : (
        <Button size="sm" onClick={() => void replay()} loading={busy}>
          Retry
        </Button>
      )}
    </ListRow>
  );
}

/** Everything that failed across videos, carousels and articles, grouped by why, with retry in place. */
export function FailuresPanel({ failures }: { failures: Failures | null }) {
  const [cat, setCat] = useState<FailureCategory | "all">("all");
  const [open, setOpen] = useState(false);
  const all = failures?.failures ?? [];
  const visible = cat === "all" ? all : all.filter((f) => f.category === cat);
  const page = usePaged(visible, 25, cat);
  if (!failures || failures.total === 0) return null;
  const shown = open ? page.shown : visible.slice(0, 3);
  return (
    <Section
      title={`Failed · ${failures.total}`}
      action={
        visible.length > 3 ? (
          <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? "Show fewer" : `Show all ${visible.length}`}
          </Button>
        ) : undefined
      }
    >
      {Object.keys(failures.counts).length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          <Chip selected={cat === "all"} onClick={() => setCat("all")}>
            All
          </Chip>
          {ORDER.filter((c) => (failures.counts[c] ?? 0) > 0).map((c) => (
            <Chip key={c} selected={cat === c} onClick={() => setCat(c)}>
              {CATEGORY[c]} <span className="text-fg-faint tabular">{failures.counts[c]}</span>
            </Chip>
          ))}
        </div>
      )}
      <List>
        {shown.map((f) => (
          <FailureRow key={`${f.kind}:${f.id}`} f={f} />
        ))}
      </List>
      {open && (
        <div className="mt-3">
          <LoadMore shown={page.shown.length} total={page.total} onMore={page.more} noun="failures" />
        </div>
      )}
    </Section>
  );
}
