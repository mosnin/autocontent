"use client";

// Deliverables: every produced asset in one place.
//
// - Videos: published-grade renders (pipeline finals + remixes).
// - Clips: individual scene clips.
// - Images: keyframes and carousel slides, plus live image-post runs with
//   approve / retry.
// - Remixes: composition status; done ones play.
//
// Select any videos or clips (in order) and "Remix N clips" stitches them into
// a new video server-side. Playback goes through
// /api/proxy/api/v1/library/{id}/media, which streams from the volume or
// follows a presigned Wasabi URL.

import { Clapperboard, Download, FolderOpen, GalleryHorizontal, Play, RotateCcw, Scissors } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { AskPill, Button, ButtonLink, Column, EmptyLine, FilterPill, IconTile, Input, List, ListRow, Modal, Notice, PageHeader, PlanCard, Section, Segmented, StatusBadge, LoadMore, usePaged } from "@/design-system";
import { clientFetch } from "@/lib/client-fetcher";
import { formatRelative, titleCase } from "@/lib/format";
import { proxyFetch } from "@/lib/proxy-fetch";
import type { Composition, ImagePost, MediaAsset, Niche } from "@/lib/types";
import { formatDuration, isImage, KIND_WORD, MediaCard, mediaUrl } from "./media-card";

const POLL_MS = 5000;

type Tab = "all" | "videos" | "clips" | "images" | "remixes";

export interface LibraryData {
  initialFinals: MediaAsset[];
  initialClips: MediaAsset[];
  initialImages: MediaAsset[];
  initialCompositions: Composition[];
  initialImagePosts: ImagePost[];
  niches: Pick<Niche, "id" | "title">[];
  /** Fixture mode (preview): render the initial data and never fetch. */
  offline?: boolean;
  /** The server couldn't reach the API at all. */
  loadError?: boolean;
}

/** Deliverables (ref 07, Column lg): a segmented control, then a grid of thumbs. */
export function LibraryView({ initialFinals, initialClips, initialImages, initialCompositions, initialImagePosts, niches, offline, loadError }: LibraryData) {
  const [tab, setTab] = useState<Tab>("all");
  const [niche, setNiche] = useState("all");
  const q = niche === "all" ? "" : `&niche_id=${encodeURIComponent(niche)}`;
  const key = (path: string) => (offline ? null : path);
  const all = niche === "all";

  const { data: finals } = useSWR<MediaAsset[]>(key(`/api/v1/library?kind=final&limit=100${q}`), clientFetch, { fallbackData: all ? initialFinals : undefined });
  const { data: remixOutputs } = useSWR<MediaAsset[]>(key(`/api/v1/library?kind=composition&limit=100${q}`), clientFetch);
  const { data: clips } = useSWR<MediaAsset[]>(key(`/api/v1/library?kind=clip&limit=200${q}`), clientFetch, { fallbackData: all ? initialClips : undefined });
  const { data: images } = useSWR<MediaAsset[]>(key(`/api/v1/library?kind=keyframe&limit=200${q}`), clientFetch, { fallbackData: all ? initialImages : undefined });
  const { data: compositions, mutate: mutateCompositions } = useSWR<Composition[]>(key("/api/v1/library/compositions?limit=50"), clientFetch, {
    fallbackData: initialCompositions,
    refreshInterval: (latest) => (latest?.some((c) => c.status === "queued" || c.status === "rendering") ? POLL_MS : 0),
  });
  const { data: imagePosts, mutate: mutatePosts } = useSWR<ImagePost[]>(key("/api/v1/image-posts?limit=25"), clientFetch, {
    fallbackData: initialImagePosts,
    refreshInterval: (latest) => (latest?.some((p) => p.status !== "done" && p.status !== "failed") ? POLL_MS : 0),
  });

  const offlineFilter = (list: MediaAsset[]) => (offline && !all ? list.filter((a) => a.niche_id === niche) : list);
  const videos = useMemo(() => {
    const byId = new Map<string, MediaAsset>();
    for (const a of [...(finals ?? []), ...(remixOutputs ?? [])]) byId.set(a.id, a);
    return offlineFilter([...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finals, remixOutputs, offline, niche]);
  const clipList = offlineFilter(clips ?? []);
  const imageList = offlineFilter(images ?? []);
  const everything = useMemo(() => [...videos, ...clipList, ...imageList].sort((a, b) => b.created_at.localeCompare(a.created_at)), [videos, clipList, imageList]);
  const comps = compositions ?? [];
  const activePosts = (imagePosts ?? []).filter((p) => p.status !== "done");

  const nicheTitle = useMemo(() => {
    const m = new Map(niches.map((n) => [n.id, n.title]));
    return (id: string | null) => (id ? (m.get(id) ?? "") : "");
  }, [niches]);

  // ---- remix selection (order matters: clips are stitched as selected)
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{ ok?: string; error?: string } | null>(null);
  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const stopSelecting = () => {
    setSelecting(false);
    setSelected([]);
    setTitle("");
  };

  async function createRemix() {
    setCreating(true);
    setNotice(null);
    try {
      await proxyFetch<Composition>("/api/v1/library/compositions", "POST", { clip_asset_ids: selected, title, audio_mode: "keep" });
      setNotice({ ok: "Remix queued. It lands in Videos when it's done." });
      stopSelecting();
      setTab("remixes");
      await mutateCompositions();
    } catch (e) {
      setNotice({ error: e instanceof Error ? e.message : "Couldn't create the remix" });
    } finally {
      setCreating(false);
    }
  }

  const [open, setOpen] = useState<MediaAsset | null>(null);

  const tabs: { value: Tab; label: string; count: number }[] = [
    { value: "all", label: "All", count: everything.length },
    { value: "videos", label: "Videos", count: videos.length },
    { value: "clips", label: "Clips", count: clipList.length },
    { value: "images", label: "Images", count: imageList.length },
    { value: "remixes", label: "Remixes", count: comps.length },
  ];
  const shownTabs = tabs.filter((t) => t.value === "all" || t.value === tab || t.count > 0);
  const pickable = tab === "all" ? everything.filter((a) => !isImage(a)) : tab === "videos" ? videos : tab === "clips" ? clipList : [];
  const canSelect = tab === "all" || tab === "videos" || tab === "clips";
  const total = everything.length;
  const empty = total === 0 && comps.length === 0;

  const gridAssets = tab === "all" ? everything : tab === "videos" ? videos : tab === "clips" ? clipList : imageList;
  // The grid is capped: 30 cards (a full row at every column count), then "Load more".
  const grid = usePaged(gridAssets, 30, `${tab}:${niche}`);
  const gridEmpty = tab === "videos" ? "No finished videos yet." : tab === "clips" ? "No clips yet." : tab === "images" ? "No images yet." : "Nothing for this playbook yet.";

  return (
    <>
      <PageHeader
        icon={<FolderOpen />}
        title="Deliverables"
        actions={
          canSelect &&
          !empty &&
          (selecting ? (
            <Button size="md" variant="ghost" onClick={stopSelecting}>
              Cancel
            </Button>
          ) : (
            <Button size="md" onClick={() => setSelecting(true)} disabled={pickable.length === 0}>
              <Scissors />
              Select to remix
            </Button>
          ))
        }
      />
      <Column
        width="lg"
        title="Deliverables"
        description={empty ? "Videos, clips and images" : `${videos.length} videos · ${clipList.length} clips · ${imageList.length} images`}
        control={
          <div className="flex flex-wrap items-center gap-2">
            <div className="-mx-5 min-w-0 max-w-[calc(100%+2.5rem)] overflow-x-auto px-5 [scrollbar-width:none] sm:mx-0 sm:max-w-full sm:px-0">
              <Segmented
                label="Kind"
                value={tab}
                onChange={setTab}
                options={shownTabs.map((t) => ({
                  value: t.value,
                  label: (
                    <>
                      {t.label}
                      <span className="text-fg-faint tabular">{t.count}</span>
                    </>
                  ),
                }))}
              />
            </div>
            {niches.length > 0 && (
              <div className="ml-auto">
                <FilterPill label="Playbook" value={niche} onChange={setNiche} options={[{ value: "all", label: "All playbooks" }, ...niches.map((n) => ({ value: n.id, label: n.title }))]} />
              </div>
            )}
          </div>
        }
      >
        {notice && <Notice ok={notice.ok} error={notice.error} />}
        {selecting && canSelect && <p className="-mb-6 text-[13px] text-fg-muted">Pick videos or clips in the order you want them.</p>}

        {loadError && empty ? (
          <EmptyLine>Couldn&apos;t load your deliverables. Try again in a moment.</EmptyLine>
        ) : empty && all ? (
          <EmptyLine action={<ButtonLink href="/sessions/new?dept=content&q=Make%20my%20first%20video" size="sm">Ask for a video</ButtonLink>}>Nothing made yet.</EmptyLine>
        ) : tab === "remixes" ? (
          <RemixList compositions={comps} onPlay={(id, t) => setOpen({ id, title: t, kind: "composition" } as MediaAsset)} />
        ) : (
          <>
            {tab === "images" && activePosts.length > 0 && <ImagePostRuns posts={activePosts} nicheTitle={nicheTitle} onChanged={() => void mutatePosts()} />}
            {gridAssets.length === 0 ? (
              <EmptyLine>{gridEmpty}</EmptyLine>
            ) : (
              <div className="space-y-5">
              <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {grid.shown.map((a) => (
                  <MediaCard
                    key={a.id}
                    asset={a}
                    playbook={nicheTitle(a.niche_id)}
                    selecting={selecting && canSelect && !isImage(a)}
                    order={selected.indexOf(a.id)}
                    onToggle={() => toggle(a.id)}
                    onOpen={() => (isImage(a) ? window.open(mediaUrl(a.id), "_blank", "noopener") : setOpen(a))}
                  />
                ))}
              </div>
              <LoadMore shown={grid.shown.length} total={grid.total} onMore={grid.more} noun={tab === "all" ? "deliverables" : tab} />
              </div>
            )}
          </>
        )}

        {selecting ? (
          <div className="pointer-events-none sticky bottom-4 z-20 flex justify-center">
            <div className="ds-pop pointer-events-auto flex w-full max-w-xl flex-wrap items-center gap-2 rounded-ds-xl border border-hairline-strong bg-overlay p-1.5 pl-3.5 shadow-ds-float sm:flex-nowrap" style={{ ["--origin" as string]: "bottom center" }}>
              <span className="shrink-0 text-[13px] font-medium tabular">{selected.length} selected</span>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Remix title (optional)" aria-label="Remix title" className="!h-7 min-w-0 flex-1 basis-40" />
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <Button variant="ghost" onClick={() => setSelected([])} disabled={creating || selected.length === 0}>
                  Clear
                </Button>
                <Button variant="primary" onClick={() => void createRemix()} disabled={selected.length === 0} loading={creating}>
                  Remix {selected.length || ""} clip{selected.length === 1 ? "" : "s"}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          !empty && <AskPill label="Ask about your deliverables" href={`/sessions/new?dept=content&q=${encodeURIComponent("Which of my recent videos performed best, and what should I make next?")}`} />
        )}
      </Column>

      <Modal
        open={open != null}
        onClose={() => setOpen(null)}
        title={open?.title || "Video"}
        width="lg"
        footer={
          open && (
            <>
              <span className="mr-auto truncate text-[12px] text-fg-muted">{[KIND_WORD[open.kind], nicheTitle(open.niche_id ?? null), formatDuration(open.duration_sec)].filter(Boolean).join(" · ")}</span>
              <ButtonLink href={mediaUrl(open.id)} download>
                <Download />
                Download
              </ButtonLink>
            </>
          )
        }
      >
        {open && <video src={mediaUrl(open.id)} controls autoPlay playsInline className="max-h-[64vh] w-full rounded-ds-md bg-surface-2 object-contain" />}
      </Modal>
    </>
  );
}

function compositionStatus(c: Composition) {
  if (c.status === "done") return <StatusBadge tone="positive">Ready</StatusBadge>;
  if (c.status === "failed") return <StatusBadge tone="negative">Failed</StatusBadge>;
  return <StatusBadge>{c.status === "queued" ? "Queued" : "Rendering"}</StatusBadge>;
}

function RemixList({ compositions, onPlay }: { compositions: Composition[]; onPlay: (assetId: string, title: string) => void }) {
  if (compositions.length === 0) return <EmptyLine>No remixes yet. Select videos or clips to make one.</EmptyLine>;
  return (
    <List>
      {compositions.map((c) => {
        const t = c.title || `Remix ${c.id.slice(0, 8)}`;
        const ready = c.status === "done" && c.output_asset_id;
        return (
          <ListRow key={c.id} className="flex-wrap gap-y-2">
            <IconTile>
              <Clapperboard />
            </IconTile>
            <div className="min-w-0 flex-1 basis-[180px]">
              <div className="truncate text-[13px]">{t}</div>
              <div className="truncate text-[12px] text-fg-muted" suppressHydrationWarning>
                {c.clip_asset_ids.length} clip{c.clip_asset_ids.length === 1 ? "" : "s"} · {formatRelative(c.created_at)}
                {c.error && <span className="text-negative"> · {c.error}</span>}
              </div>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {compositionStatus(c)}
              {ready && (
                <Button size="sm" onClick={() => onPlay(c.output_asset_id!, t)}>
                  <Play />
                  Play
                </Button>
              )}
            </div>
          </ListRow>
        );
      })}
    </List>
  );
}

/** Live carousel/still runs: approve the ones waiting (plan cards), retry the failed ones. */
function ImagePostRuns({ posts, nicheTitle, onChanged }: { posts: ImagePost[]; nicheTitle: (id: string | null) => string; onChanged: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const act = async (p: ImagePost, verb: "approve" | "retry") => {
    setBusy(p.id);
    setError(null);
    try {
      await proxyFetch(`/api/v1/image-posts/${p.id}/${verb}`, "POST", {});
      onChanged();
      router.refresh();
    } catch (e) {
      setError({ id: p.id, text: e instanceof Error ? e.message : `Couldn't ${verb}` });
    } finally {
      setBusy(null);
    }
  };
  const name = (p: ImagePost) => p.topic || (p.kind === "carousel" ? "Carousel" : "Still");
  const what = (p: ImagePost) => [p.kind === "carousel" ? `Carousel · ${p.payload?.slide_count ?? "?"} slides` : "Still", nicheTitle(p.niche_id)].filter(Boolean).join(" · ");
  const waiting = posts.filter((p) => p.status === "awaiting_approval");
  const rest = posts.filter((p) => p.status !== "awaiting_approval");
  return (
    <Section title="Image post runs">
      <div className="space-y-3">
        {waiting.map((p) => (
          <div key={p.id}>
            <PlanCard title={name(p)} icon={<GalleryHorizontal className="size-3.5 text-on-fill" />} meta="Needs you" steps={[{ label: what(p) }, { label: "Post it once approved" }]} onApprove={() => void act(p, "approve")} approving={busy === p.id} approveLabel="Approve & post" />
            {error?.id === p.id && (
              <div className="px-1 pt-1.5">
                <Notice error={error.text} />
              </div>
            )}
          </div>
        ))}
        {rest.length > 0 && (
          <List>
            {rest.map((p) => (
              <ListRow key={p.id} className="flex-wrap gap-y-2">
                <IconTile>
                  <GalleryHorizontal />
                </IconTile>
                <div className="min-w-0 flex-1 basis-[180px]">
                  <div className="truncate text-[13px]">{name(p)}</div>
                  <div className="truncate text-[12px] text-fg-muted">{what(p)}</div>
                  {(p.error || error?.id === p.id) && (
                    <div className="truncate text-[12px] text-negative" title={p.error ?? undefined}>
                      {error?.id === p.id ? error.text : p.error}
                    </div>
                  )}
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  {p.status === "failed" ? (
                    <>
                      <StatusBadge tone="negative">Failed</StatusBadge>
                      <Button size="sm" onClick={() => void act(p, "retry")} loading={busy === p.id}>
                        <RotateCcw />
                        Retry
                      </Button>
                    </>
                  ) : (
                    <StatusBadge>{titleCase(p.status)}</StatusBadge>
                  )}
                </div>
              </ListRow>
            ))}
          </List>
        )}
      </div>
    </Section>
  );
}
