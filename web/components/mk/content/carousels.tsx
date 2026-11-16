"use client";

import { GalleryHorizontal, Image as ImageIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { ImagePost, Niche } from "@/lib/types";
import { List } from "../page";
import { Button, Chip, Empty, IconTile } from "../ui";
import { postProxy, StatusWord, Time } from "./bits";
import { postDot, postStatusLabel, postTitle, postTone, POST_IN_PROGRESS } from "./status";

type Filter = "all" | "awaiting" | "in_progress" | "done" | "failed";
const FILTERS: { value: Filter; label: string; match: (p: ImagePost) => boolean }[] = [
  { value: "all", label: "All", match: () => true },
  { value: "awaiting", label: "Needs approval", match: (p) => p.status === "awaiting_approval" },
  { value: "in_progress", label: "In progress", match: (p) => POST_IN_PROGRESS.has(p.status) },
  { value: "done", label: "Done", match: (p) => p.status === "done" },
  { value: "failed", label: "Failed", match: (p) => p.status === "failed" },
];

function CarouselRow({ post, playbook }: { post: ImagePost; playbook?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const act = async (verb: "approve" | "reject" | "retry") => {
    if (verb === "reject" && !window.confirm("Reject this carousel? It will never post.")) return;
    setBusy(verb);
    setError(null);
    try {
      await postProxy(`/api/v1/image-posts/${post.id}/${verb}`);
      setDone(verb === "approve" ? "Approved" : verb === "reject" ? "Rejected" : "Retrying");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  const slideCount = post.payload?.slide_count;
  const slides = Array.isArray(post.payload?.slides) ? (post.payload.slides as { index: number; heading?: string }[]) : [];
  const caption = typeof post.payload?.caption === "string" ? (post.payload.caption as string) : "";
  const hashtags = Array.isArray(post.payload?.hashtags) ? (post.payload.hashtags as string[]) : [];
  const hasDetail = slides.length > 0 || caption;

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <IconTile>{post.kind === "carousel" ? <GalleryHorizontal /> : <ImageIcon />}</IconTile>
        <button type="button" onClick={() => hasDetail && setOpen((v) => !v)} className="min-w-0 flex-1 basis-[200px] text-left" aria-expanded={hasDetail ? open : undefined}>
          <div className="truncate text-[14px] font-medium">{postTitle(post)}</div>
          <div className="truncate text-[13px] text-muted-foreground">
            {playbook ? `${playbook} · ` : ""}
            {post.kind === "carousel" ? `Carousel${slideCount ? `, ${slideCount} slides` : ""}` : "Single image"}
            <span className="text-faint">
              {" · "}
              <Time iso={post.created_at} />
            </span>
          </div>
          {post.status === "failed" && post.error && <div className="mt-0.5 line-clamp-2 text-[12px] text-destructive">{post.error}</div>}
          {error && <div className="mt-0.5 text-[12px] text-destructive">{error}</div>}
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <StatusWord label={postStatusLabel(post.status)} tone={postTone(post.status)} dot={postDot(post.status)} />
          {done ? (
            <span className="text-[13px] text-muted-foreground">{done}</span>
          ) : post.status === "failed" ? (
            <Button size="sm" onClick={() => void act("retry")} loading={busy === "retry"}>
              Retry
            </Button>
          ) : post.status === "awaiting_approval" ? (
            <span className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => void act("reject")} disabled={busy !== null} loading={busy === "reject"}>
                Reject
              </Button>
              <Button size="sm" variant="primary" onClick={() => void act("approve")} disabled={busy !== null} loading={busy === "approve"}>
                Approve
              </Button>
            </span>
          ) : null}
        </div>
      </div>
      {open && hasDetail && (
        <div className="t-enter mt-3 space-y-3 rounded-[14px] bg-subtle p-3 sm:ml-11">
          {slides.length > 0 && (
            <ol className="flex gap-2 overflow-x-auto pb-1">
              {slides.map((s) => (
                <li key={s.index} className="flex aspect-[4/5] w-24 shrink-0 flex-col justify-between rounded-lg border border-border bg-card p-2">
                  <span className="text-[11px] text-faint tabular">{s.index + 1}</span>
                  <span className="line-clamp-3 text-[12px] font-medium leading-tight">{s.heading}</span>
                </li>
              ))}
            </ol>
          )}
          {caption && <p className="whitespace-pre-wrap text-[13px] text-muted-foreground">{caption}</p>}
          {hashtags.length > 0 && <p className="text-[13px] text-accent">{hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}</p>}
        </div>
      )}
    </div>
  );
}

export function CarouselsList({ posts, niches, onMake }: { posts: ImagePost[] | null; niches: Niche[]; onMake: () => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const titles = useMemo(() => new Map(niches.map((n) => [n.id, n.title])), [niches]);
  if (posts === null) return <Empty art="activity" title="Couldn't load carousels">The API didn't answer. Try again in a moment.</Empty>;
  if (posts.length === 0)
    return (
      <Empty art="files" title="No carousels yet" action={<Button variant="primary" onClick={onMake}>Make a carousel</Button>}>
        Swipeable image posts for Reels and TikTok, planned and rendered from a playbook.
      </Empty>
    );
  const f = FILTERS.find((x) => x.value === filter)!;
  const visible = posts.filter(f.match);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((x) => (
          <Chip key={x.value} selected={filter === x.value} onClick={() => setFilter(x.value)}>
            {x.label}
            <span className="tabular text-faint">{posts.filter(x.match).length}</span>
          </Chip>
        ))}
        <Button size="sm" variant="secondary" className="ml-auto" onClick={onMake}>
          New carousel
        </Button>
      </div>
      {visible.length === 0 ? (
        <p className="rounded-[14px] bg-subtle px-4 py-5 text-[13px] text-muted-foreground">Nothing here. Try another filter.</p>
      ) : (
        <List>
          {visible.map((p) => (
            <CarouselRow key={p.id} post={p} playbook={titles.get(p.niche_id)} />
          ))}
        </List>
      )}
    </div>
  );
}
