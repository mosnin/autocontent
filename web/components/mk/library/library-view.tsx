"use client";

// Media library: every produced asset in one place (re-skin of the old
// app/(app)/library/LibraryClient with the same behaviour).
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

import { Clapperboard, Download, GalleryHorizontal, Library as LibraryIcon, Play, RotateCcw, Scissors, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { clientFetch } from "@/lib/client-fetcher";
import { formatRelative, titleCase } from "@/lib/format";
import type { Composition, ImagePost, MediaAsset, Niche } from "@/lib/types";
import { List, PageBody, PageHeader, PageIntro, Row } from "../page";
import { Badge, Button, ButtonLink, Chip, cx, Dot, Empty, IconTile, Input, Modal, Select } from "../ui";
import { formatDuration, isImage, KIND_WORD, MediaCard, mediaUrl } from "./media-card";

const POLL_MS = 5000;

type Tab = "videos" | "clips" | "images" | "remixes";

async function clientPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      const j = JSON.parse(text) as { detail?: unknown };
      if (typeof j.detail === "string") detail = j.detail;
    } catch {
      /* plain text */
    }
    throw new Error(detail.slice(0, 200) || `Failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

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

export function LibraryView({ initialFinals, initialClips, initialImages, initialCompositions, initialImagePosts, niches, offline, loadError }: LibraryData) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("videos");
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
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
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
      await clientPost<Composition>("/api/v1/library/compositions", { clip_asset_ids: selected, title, audio_mode: "keep" });
      setNotice({ tone: "ok", text: "Remix queued. It's rendering now and lands in Videos when it's done." });
      stopSelecting();
      setTab("remixes");
      await mutateCompositions();
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "Couldn't create the remix" });
    } finally {
      setCreating(false);
    }
  }

  const [open, setOpen] = useState<MediaAsset | null>(null);

  const TABS: { value: Tab; label: string; count: number }[] = [
    { value: "videos", label: "Videos", count: videos.length },
    { value: "clips", label: "Clips", count: clipList.length },
    { value: "images", label: "Images", count: imageList.length },
    { value: "remixes", label: "Remixes", count: comps.length },
  ];
  const canSelect = tab === "videos" || tab === "clips";
  const total = videos.length + clipList.length + imageList.length;

  return (
    <>
      <PageHeader icon={<LibraryIcon />} title="Library">
        {canSelect &&
          (selecting ? (
            <Button size="sm" variant="ghost" onClick={stopSelecting}>
              Cancel
            </Button>
          ) : (
            <Button size="sm" onClick={() => setSelecting(true)} disabled={(tab === "videos" ? videos : clipList).length === 0}>
              <Scissors />
              Select to remix
            </Button>
          ))}
      </PageHeader>
      <PageBody width="6xl" className="pb-6">
        <PageIntro title="Everything you've made">Every video, clip and image the departments produced. Play anything, or pick clips in order and remix them into a new video.</PageIntro>

        <div className="mb-5 flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Kind" className="-mx-5 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-5 [scrollbar-width:none] sm:mx-0 sm:px-0">
            {TABS.map((t) => (
              <Chip key={t.value} selected={tab === t.value} onClick={() => setTab(t.value)} className="shrink-0">
                {t.label}
                <span className="text-faint tabular">{t.count}</span>
              </Chip>
            ))}
          </div>
          {niches.length > 0 && (
            <Select aria-label="Filter by playbook" value={niche} onChange={(e) => setNiche(e.target.value)} className="!h-8 w-full !rounded-full !py-0 text-[13px] sm:w-48">
              <option value="all">All playbooks</option>
              {niches.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </Select>
          )}
        </div>

        {notice && (
          <div role={notice.tone === "error" ? "alert" : "status"} className={cx("mb-5 flex items-center gap-3 rounded-[14px] px-4 py-2.5 text-[13px]", notice.tone === "error" ? "bg-destructive/10 text-destructive" : "bg-floor/12 text-floor")}>
            <span className="min-w-0 flex-1">{notice.text}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="press flex opacity-70 hover:opacity-100 [&_svg]:size-4">
              <X />
            </button>
          </div>
        )}

        {selecting && canSelect && <p className="mb-4 text-[13px] text-muted-foreground">Tap videos or clips in the order you want them. You can mix both tabs.</p>}

        {loadError && total === 0 && comps.length === 0 ? (
          <Empty art="files" title="Couldn't load your library">The API didn't answer. Try again in a moment.</Empty>
        ) : total === 0 && comps.length === 0 && all ? (
          <Empty art="files" title="Nothing here yet" action={<ButtonLink href="/sessions/new?dept=content&q=Make%20my%20first%20video" variant="primary">Ask for a video</ButtonLink>}>
            Every video, scene clip and image the Content producer renders is saved here automatically.
          </Empty>
        ) : tab === "remixes" ? (
          <RemixList compositions={comps} onPlay={(id, t) => setOpen({ id, title: t, kind: "composition" } as MediaAsset)} />
        ) : (
          <>
            {tab === "images" && activePosts.length > 0 && <ImagePostRuns posts={activePosts} nicheTitle={nicheTitle} onChanged={() => void mutatePosts()} />}
            <Grid
              assets={tab === "videos" ? videos : tab === "clips" ? clipList : imageList}
              empty={tab === "videos" ? "No finished videos yet. Run a playbook and they land here." : tab === "clips" ? "No clips yet. Every rendered scene is saved here automatically." : "No images yet. Carousel slides and keyframes land here."}
              nicheTitle={nicheTitle}
              selecting={selecting && canSelect}
              selected={selected}
              onToggle={toggle}
              onOpen={(a) => (isImage(a) ? window.open(mediaUrl(a.id), "_blank", "noopener") : setOpen(a))}
            />
          </>
        )}

        {/* Bottom action bar while picking clips. */}
        {selecting && (
          <div className="pointer-events-none sticky bottom-4 z-20 mt-8 flex justify-center">
            <div className="t-pop pointer-events-auto flex w-full max-w-xl flex-wrap items-center gap-2 rounded-[20px] border border-border bg-card p-2 pl-4 shadow-float sm:flex-nowrap sm:rounded-full dark:bg-muted" style={{ ["--origin" as string]: "bottom center" }}>
              <span className="shrink-0 text-[13px] font-medium tabular">{selected.length} selected</span>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Remix title (optional)" aria-label="Remix title" className="!h-8 min-w-0 flex-1 basis-40 !rounded-full !py-0 text-[13px]" />
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => setSelected([])} disabled={creating || selected.length === 0}>
                  Clear
                </Button>
                <Button size="sm" variant="primary" onClick={() => void createRemix()} disabled={selected.length === 0} loading={creating}>
                  Remix {selected.length || ""} clip{selected.length === 1 ? "" : "s"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </PageBody>

      <Modal open={open != null} onClose={() => setOpen(null)} title={open?.title || "Video"} bare>
        {open && (
          <div>
            <div className="flex items-center justify-between gap-3 px-5 py-3.5">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-medium">{open.title || "Untitled"}</div>
                <div className="truncate text-[12px] text-muted-foreground">{[KIND_WORD[open.kind], nicheTitle(open.niche_id ?? null), formatDuration(open.duration_sec)].filter(Boolean).join(" · ")}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <a href={mediaUrl(open.id)} download className="press flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-4" aria-label="Download" title="Download">
                  <Download />
                </a>
                <Button variant="ghost" size="icon" className="size-8" onClick={() => setOpen(null)} aria-label="Close" title="Close">
                  <X />
                </Button>
              </div>
            </div>
            <video src={mediaUrl(open.id)} controls autoPlay playsInline className="max-h-[72vh] w-full bg-black object-contain" />
          </div>
        )}
      </Modal>
    </>
  );
}

function Grid({
  assets,
  empty,
  nicheTitle,
  selecting,
  selected,
  onToggle,
  onOpen,
}: {
  assets: MediaAsset[];
  empty: string;
  nicheTitle: (id: string | null) => string;
  selecting: boolean;
  selected: string[];
  onToggle: (id: string) => void;
  onOpen: (a: MediaAsset) => void;
}) {
  if (assets.length === 0) return <p className="rounded-[14px] bg-subtle px-4 py-5 text-[13px] text-muted-foreground">{empty}</p>;
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {assets.map((a) => (
        <MediaCard key={a.id} asset={a} playbook={nicheTitle(a.niche_id)} selecting={selecting && !isImage(a)} order={selected.indexOf(a.id)} onToggle={() => onToggle(a.id)} onOpen={() => onOpen(a)} />
      ))}
    </div>
  );
}

function compositionStatus(c: Composition) {
  if (c.status === "done") return <Badge tone="live">Ready</Badge>;
  if (c.status === "failed") return <Badge tone="danger">Failed</Badge>;
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
      <Dot tone="live" />
      {c.status === "queued" ? "Queued" : "Rendering"}
    </span>
  );
}

function RemixList({ compositions, onPlay }: { compositions: Composition[]; onPlay: (assetId: string, title: string) => void }) {
  if (compositions.length === 0) return <p className="rounded-[14px] bg-subtle px-4 py-5 text-[13px] text-muted-foreground">No remixes yet. Select videos or clips and remix them into something new.</p>;
  return (
    <List>
      {compositions.map((c) => {
        const t = c.title || `Remix ${c.id.slice(0, 8)}`;
        const ready = c.status === "done" && c.output_asset_id;
        return (
          <Row key={c.id} className="flex-wrap gap-y-2">
            <IconTile tone={c.status === "rendering" || c.status === "queued" ? "live" : "muted"}>
              <Clapperboard />
            </IconTile>
            <div className="min-w-0 flex-1 basis-[180px]">
              <div className="truncate text-[14px] font-medium">{t}</div>
              <div className="truncate text-[13px] text-muted-foreground" suppressHydrationWarning>
                {c.clip_asset_ids.length} clip{c.clip_asset_ids.length === 1 ? "" : "s"} · {formatRelative(c.created_at)}
                {c.error && <span className="text-destructive"> · {c.error}</span>}
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
          </Row>
        );
      })}
    </List>
  );
}

/** Live carousel/still runs: approve the ones waiting, retry the failed ones. */
function ImagePostRuns({ posts, nicheTitle, onChanged }: { posts: ImagePost[]; nicheTitle: (id: string | null) => string; onChanged: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const act = async (p: ImagePost, verb: "approve" | "retry") => {
    setBusy(p.id);
    setError(null);
    try {
      await clientPost(`/api/v1/image-posts/${p.id}/${verb}`, {});
      onChanged();
      router.refresh();
    } catch (e) {
      setError({ id: p.id, text: e instanceof Error ? e.message : `Couldn't ${verb}` });
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="mb-6">
      <h2 className="mb-2.5 text-[13px] text-muted-foreground">Image post runs</h2>
      <List>
        {posts.map((p) => (
          <Row key={p.id} className="flex-wrap gap-y-2">
            <IconTile tone={p.status === "failed" || p.status === "awaiting_approval" ? "muted" : "live"}>
              <GalleryHorizontal />
            </IconTile>
            <div className="min-w-0 flex-1 basis-[180px]">
              <div className="truncate text-[14px] font-medium">{p.topic || (p.kind === "carousel" ? "Carousel" : "Still")}</div>
              <div className="truncate text-[13px] text-muted-foreground">
                {p.kind === "carousel" ? `Carousel · ${p.payload?.slide_count ?? "?"} slides` : "Still"}
                {nicheTitle(p.niche_id) && ` · ${nicheTitle(p.niche_id)}`}
              </div>
              {(p.error || error?.id === p.id) && <div className="truncate text-[12px] text-destructive" title={p.error ?? undefined}>{error?.id === p.id ? error.text : p.error}</div>}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {p.status === "awaiting_approval" ? (
                <>
                  <Dot tone="warn" label="Needs you" />
                  <Button size="sm" variant="primary" onClick={() => void act(p, "approve")} loading={busy === p.id}>
                    Approve & post
                  </Button>
                </>
              ) : p.status === "failed" ? (
                <>
                  <Badge tone="danger">Failed</Badge>
                  <Button size="sm" onClick={() => void act(p, "retry")} loading={busy === p.id}>
                    <RotateCcw />
                    Retry
                  </Button>
                </>
              ) : (
                <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  <Dot tone="live" />
                  {titleCase(p.status)}
                </span>
              )}
            </div>
          </Row>
        ))}
      </List>
    </section>
  );
}
