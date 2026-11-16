"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Panel } from "../page";
import { Badge, Button, Chip } from "../ui";
import { postProxy, Time } from "./bits";
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
      await postProxy(`/api/v1/failures/replay/${f.kind}/${f.id}`);
      setDone(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 first:pt-0 last:pb-0">
      <Link href={href(f)} className="min-w-0 flex-1 basis-[220px]">
        <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="font-medium">{KIND[f.kind]}</span>
          <Badge tone={f.category === "spend_cap" || f.category === "provider_error" ? "danger" : "muted"}>{CATEGORY[f.category]}</Badge>
          {f.niche_title && <span className="text-muted-foreground">{f.niche_title}</span>}
          <span className="text-faint">
            <Time iso={f.created_at} />
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{f.error ?? "No error message was recorded."}</p>
        {error && <p className="text-[12px] text-destructive">{error}</p>}
      </Link>
      {done ? <span className="text-[13px] text-muted-foreground">Retrying</span> : <Button size="sm" onClick={() => void replay()} loading={busy}>Retry</Button>}
    </li>
  );
}

/** Everything that failed across videos, carousels and articles, grouped by why, with retry in place. */
export function FailuresPanel({ failures }: { failures: Failures | null }) {
  const [cat, setCat] = useState<FailureCategory | "all">("all");
  const [open, setOpen] = useState(false);
  if (!failures || failures.total === 0) return null;
  const visible = cat === "all" ? failures.failures : failures.failures.filter((f) => f.category === cat);
  const shown = open ? visible : visible.slice(0, 3);
  return (
    <Panel
      label={
        <span className="flex items-center gap-2">
          <span className="inline-block size-[7px] rounded-full bg-destructive" aria-hidden />
          {failures.total} failed
        </span>
      }
      action={
        <div className="flex flex-wrap justify-end gap-1">
          <Chip selected={cat === "all"} onClick={() => setCat("all")} className="h-7 px-2.5">
            All
          </Chip>
          {ORDER.filter((c) => (failures.counts[c] ?? 0) > 0).map((c) => (
            <Chip key={c} selected={cat === c} onClick={() => setCat(c)} className="h-7 px-2.5">
              {CATEGORY[c]} <span className="tabular text-faint">{failures.counts[c]}</span>
            </Chip>
          ))}
        </div>
      }
    >
      <ul className="divide-y divide-border">
        {shown.map((f) => (
          <FailureRow key={`${f.kind}:${f.id}`} f={f} />
        ))}
      </ul>
      {visible.length > 3 && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-2 text-[13px] text-muted-foreground hover:text-foreground">
          {open ? "Show fewer" : `Show all ${visible.length}`}
        </button>
      )}
    </Panel>
  );
}
