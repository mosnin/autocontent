"use client";

import { ChevronDown, GalleryHorizontal, Image as ImageIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, Chip, ConfirmModal, cx, EmptyLine, List, StatusBadge, Thumb, Time, Notice } from "@/design-system";
import { proxyFetch } from "@/lib/proxy-fetch";
import type { ImagePost, Niche } from "@/lib/types";
import { postStatusLabel, postTitle, postTone, POST_IN_PROGRESS } from "./status";

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
  const [confirm, setConfirm] = useState(false);

  const act = async (verb: "approve" | "reject" | "retry") => {
    setBusy(verb);
    setError(null);
    try {
      await proxyFetch(`/api/v1/image-posts/${post.id}/${verb}`, "POST");
      setDone(verb === "approve" ? "Approved" : verb === "reject" ? "Rejected" : "Retrying");
      setConfirm(false);
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
  const hasDetail = slides.length > 0 || Boolean(caption);

  return (
    <div>
      <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5">
        <Thumb ratio="4/5" className="w-[34px] shrink-0">
          <span className="absolute inset-0 flex items-center justify-center text-fg-faint [&_svg]:size-3.5">{post.kind === "carousel" ? <GalleryHorizontal /> : <ImageIcon />}</span>
        </Thumb>
        <button type="button" onClick={() => hasDetail && setOpen((v) => !v)} className="min-w-0 flex-1 basis-[180px] text-left" aria-expanded={hasDetail ? open : undefined}>
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-medium">{postTitle(post)}</span>
            {hasDetail && <ChevronDown className={cx("size-3.5 shrink-0 text-fg-faint transition-transform duration-200", !open && "-rotate-90")} />}
          </div>
          <div className="truncate text-[12px] text-fg-muted">
            {playbook ? `${playbook} · ` : ""}
            {post.kind === "carousel" ? `Carousel${slideCount ? `, ${slideCount} slides` : ""}` : "Single image"}
            {" · "}
            <Time iso={post.created_at} />
          </div>
          {post.status === "failed" && post.error && <div className="mt-0.5 line-clamp-1 text-[12px] text-negative">{post.error}</div>}
          {error && !confirm && <Notice inline error={error} />}
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-2.5">
          <StatusBadge tone={postTone(post.status)}>{postStatusLabel(post.status)}</StatusBadge>
          {done ? (
            <span className="text-[12.5px] text-fg-muted">{done}</span>
          ) : post.status === "failed" ? (
            <Button size="sm" onClick={() => void act("retry")} loading={busy === "retry"}>
              Retry
            </Button>
          ) : post.status === "awaiting_approval" ? (
            <span className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} disabled={busy !== null}>
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
        <div className="ds-enter space-y-3 border-t border-hairline bg-surface-2 px-3.5 py-3">
          {slides.length > 0 && (
            <ol className="flex gap-2 overflow-x-auto pb-1">
              {slides.map((s) => (
                <li key={s.index} className="w-24 shrink-0">
                  <Thumb ratio="4/5" className="bg-surface">
                    <span className="absolute inset-0 flex flex-col justify-between p-2">
                      <span className="text-[11px] text-fg-faint tabular">{s.index + 1}</span>
                      <span className="line-clamp-3 text-[12px] font-medium leading-tight">{s.heading}</span>
                    </span>
                  </Thumb>
                </li>
              ))}
            </ol>
          )}
          {caption && <p className="whitespace-pre-wrap text-[13px] text-fg-muted">{caption}</p>}
          {hashtags.length > 0 && <p className="text-[13px] text-ds-accent">{hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}</p>}
        </div>
      )}
      <ConfirmModal open={confirm} onClose={() => setConfirm(false)} title="Reject this carousel?" confirmLabel="Reject" danger busy={busy === "reject"} error={error} onConfirm={() => void act("reject")}>
        It will never post.
      </ConfirmModal>
    </div>
  );
}

export function CarouselsList({ posts, niches, onMake }: { posts: ImagePost[] | null; niches: Niche[]; onMake: () => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const titles = useMemo(() => new Map(niches.map((n) => [n.id, n.title])), [niches]);
  if (posts === null) return <EmptyLine>Couldn&apos;t load carousels. Try again in a moment.</EmptyLine>;
  if (posts.length === 0)
    return (
      <EmptyLine
        action={
          <Button variant="primary" onClick={onMake}>
            Make a carousel
          </Button>
        }
      >
        No carousels yet.
      </EmptyLine>
    );
  const f = FILTERS.find((x) => x.value === filter)!;
  const visible = posts.filter(f.match);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((x) => (
          <Chip key={x.value} selected={filter === x.value} onClick={() => setFilter(x.value)}>
            {x.label}
            <span className="text-fg-faint tabular">{posts.filter(x.match).length}</span>
          </Chip>
        ))}
        <Button className="ml-auto" onClick={onMake}>
          New carousel
        </Button>
      </div>
      {visible.length === 0 ? (
        <EmptyLine>Nothing here. Try another filter.</EmptyLine>
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
