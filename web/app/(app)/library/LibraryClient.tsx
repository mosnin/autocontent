"use client";

// Media library: every produced asset in one place.
//
// - "Final videos": published-grade renders (pipeline finals + remixes).
// - "Clips": individual scene clips — multi-select any set of them and
//   create a *remix* (a new video concatenated server-side).
// - "Remixes": composition status list; done ones play inline.
//
// Playback goes through /api/proxy/api/v1/library/{id}/media which
// either streams from the volume or follows a presigned Wasabi URL.
//
// Chrome recladded to the Square UI marketing-dashboard kit
// (components/square/ui/*): Card/Badge/Button/Input/Select/Checkbox +
// the template's table anatomy (components/square/ui/table) for the
// Remixes list, which is tabular (title, clips, created, status,
// preview). Tabs has no square/ui counterpart, so it stays the existing
// app primitive (@/components/ui/tabs) — same precedent as the niches
// port. The asset grid keeps its real video/image previews exactly as
// wired today; no logic changes anywhere in this file.

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Badge } from "@/components/square/ui/badge";
import { Button } from "@/components/square/ui/button";
import { Card, CardContent } from "@/components/square/ui/card";
import { Checkbox } from "@/components/square/ui/checkbox";
import { Input } from "@/components/square/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/square/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/square/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashHeading } from "@/components/hub/dashboard-kit";
import { cn } from "@/lib/utils";
import { clientFetch } from "@/lib/client-fetcher";
import type { Composition, ImagePost, MediaAsset, Niche } from "@/lib/types";

const POLL_MS = 5000;

function mediaUrl(assetId: string): string {
  return `/api/proxy/api/v1/library/${assetId}/media`;
}

/** Ops strip for the carousel/still pipeline: live status per post plus
 *  the two operator verbs — approve (awaiting_approval) and retry
 *  (failed). Terminal successes disappear into the asset grid below. */
function ImagePostsPanel({ nicheTitle }: { nicheTitle: (id: string) => string }) {
  const { data: posts, mutate } = useSWR<ImagePost[]>(
    "/api/v1/image-posts?limit=25",
    clientFetch,
    { refreshInterval: POLL_MS },
  );
  const [busy, setBusy] = React.useState<string | null>(null);

  const act = async (post: ImagePost, verb: "approve" | "retry") => {
    setBusy(post.id);
    try {
      await clientPost(`/api/v1/image-posts/${post.id}/${verb}`, {});
      toast.success(verb === "approve" ? "Post approved" : "Retry queued");
      await mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `could not ${verb}`);
    } finally {
      setBusy(null);
    }
  };

  const active = (posts ?? []).filter((p) => p.status !== "done");
  if (active.length === 0) return null;

  return (
    <Card className="rounded-lg border bg-card">
      <CardContent className="space-y-2 p-4">
        <p className="text-sm font-medium">Image post runs</p>
        {active.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm"
          >
            <Badge
              variant="outline"
              className={cn(
                "text-xs font-medium px-2 py-0.5",
                p.status === "failed"
                  ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400 border-rose-200 dark:border-rose-900"
                  : "border text-muted-foreground bg-transparent",
              )}
            >
              {p.status.replaceAll("_", " ")}
            </Badge>
            <span className="font-medium">
              {p.kind === "carousel"
                ? `Carousel (${p.payload?.slide_count ?? "?"})`
                : "Still"}
            </span>
            <span className="text-muted-foreground">
              {p.topic || nicheTitle(p.niche_id)}
            </span>
            {p.error ? (
              <span className="w-full truncate text-xs text-destructive" title={p.error}>
                {p.error}
              </span>
            ) : null}
            <span className="ml-auto flex gap-2">
              {p.status === "awaiting_approval" && (
                <Button
                  size="sm"
                  disabled={busy === p.id}
                  onClick={() => act(p, "approve")}
                >
                  Approve & post
                </Button>
              )}
              {p.status === "failed" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === p.id}
                  onClick={() => act(p, "retry")}
                >
                  Retry
                </Button>
              )}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

async function clientPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export function LibraryClient({
  initialFinals,
  initialClips,
  initialCompositions,
  niches,
}: {
  initialFinals: MediaAsset[];
  initialClips: MediaAsset[];
  initialCompositions: Composition[];
  niches: Niche[];
}) {
  const [nicheFilter, setNicheFilter] = React.useState<string>("all");
  const nicheQuery =
    nicheFilter === "all" ? "" : `&niche_id=${encodeURIComponent(nicheFilter)}`;

  const { data: finals } = useSWR<MediaAsset[]>(
    `/api/v1/library?kind=final&limit=100${nicheQuery}`,
    clientFetch,
    { fallbackData: nicheFilter === "all" ? initialFinals : undefined },
  );
  const { data: clips } = useSWR<MediaAsset[]>(
    `/api/v1/library?kind=clip&limit=200${nicheQuery}`,
    clientFetch,
    { fallbackData: nicheFilter === "all" ? initialClips : undefined },
  );
  const { data: images } = useSWR<MediaAsset[]>(
    `/api/v1/library?kind=keyframe&limit=200${nicheQuery}`,
    clientFetch,
    // No server-side fallback: page.tsx doesn't prefetch keyframes, and
    // seeding with clip data would briefly show videos mislabeled as images.
  );
  const { data: compositions, mutate: mutateCompositions } = useSWR<Composition[]>(
    "/api/v1/library/compositions?limit=50",
    clientFetch,
    {
      fallbackData: initialCompositions,
      refreshInterval: (latest) =>
        latest?.some((c) => c.status === "queued" || c.status === "rendering")
          ? POLL_MS
          : 0,
    },
  );

  const nicheTitle = React.useMemo(() => {
    const m = new Map(niches.map((n) => [n.id, n.title]));
    return (id: string | null) => (id ? (m.get(id) ?? "") : "");
  }, [niches]);

  // --- remix selection -----------------------------------------------------
  const [selected, setSelected] = React.useState<string[]>([]);
  const [title, setTitle] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  const toggle = (id: string) =>
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );

  async function createRemix() {
    setCreating(true);
    try {
      await clientPost<Composition>("/api/v1/library/compositions", {
        clip_asset_ids: selected,
        title,
        audio_mode: "keep",
      });
      toast.success("Remix queued — rendering now");
      setSelected([]);
      setTitle("");
      await mutateCompositions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create remix");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <DashHeading as="h1" sub="Every video and clip you've produced — play, sort, remix.">
          Library
        </DashHeading>
        <Select value={nicheFilter} onValueChange={setNicheFilter}>
          <SelectTrigger className="w-48" aria-label="Filter by niche">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All niches</SelectItem>
            {niches.map((n) => (
              <SelectItem key={n.id} value={n.id}>
                {n.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="finals">
        <TabsList>
          <TabsTrigger value="finals">Final videos</TabsTrigger>
          <TabsTrigger value="clips">Clips</TabsTrigger>
          <TabsTrigger value="images">Images</TabsTrigger>
          <TabsTrigger value="remixes">Remixes</TabsTrigger>
        </TabsList>

        <TabsContent value="finals" className="pt-4">
          <AssetGrid
            assets={finals ?? []}
            nicheTitle={nicheTitle}
            empty="No final videos yet — run a job from the queue and it lands here."
          />
        </TabsContent>

        <TabsContent value="clips" className="space-y-4 pt-4">
          {selected.length > 0 && (
            <Card className="rounded-lg border-primary/40 bg-card">
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <span className="text-sm font-medium">
                  {selected.length} clip{selected.length === 1 ? "" : "s"} selected
                </span>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Remix title (optional)"
                  className="max-w-xs"
                  aria-label="Remix title"
                />
                <Button onClick={createRemix} disabled={creating}>
                  {creating ? "Queuing…" : "Create remix"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setSelected([])}
                  disabled={creating}
                >
                  Clear
                </Button>
                <p className="w-full text-xs text-muted-foreground">
                  Clips are stitched in the order you selected them.
                </p>
              </CardContent>
            </Card>
          )}
          <AssetGrid
            assets={clips ?? []}
            nicheTitle={nicheTitle}
            selectable
            selected={selected}
            onToggle={toggle}
            empty="No clips yet — every rendered scene is saved here automatically."
          />
        </TabsContent>
        <TabsContent value="images" className="space-y-4 pt-4">
          {/* Images are stills (keyframes, carousel slides, remix outputs).
              They are not video clips, so the clip-remix affordance does not
              apply here — the compositions endpoint only accepts clip/final
              assets and would 422 an image selection. Plain gallery. */}
          <ImagePostsPanel nicheTitle={nicheTitle} />
          <AssetGrid
            assets={images ?? []}
            nicheTitle={nicheTitle}
            empty="No images yet — carousel slides and image remixes land here."
          />
        </TabsContent>

        <TabsContent value="remixes" className="pt-4">
          <CompositionList compositions={compositions ?? []} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AssetGrid({
  assets,
  nicheTitle,
  selectable = false,
  selected = [],
  onToggle,
  empty,
}: {
  assets: MediaAsset[];
  nicheTitle: (id: string | null) => string;
  selectable?: boolean;
  selected?: string[];
  onToggle?: (id: string) => void;
  empty: string;
}) {
  if (assets.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {assets.map((a) => {
        const order = selected.indexOf(a.id);
        return (
          <Card key={a.id} className="overflow-hidden rounded-lg border bg-card py-0 gap-0">
            <div className="relative">
              {a.kind === "keyframe" || a.content_type?.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaUrl(a.id)}
                  alt={a.title || "image"}
                  loading="lazy"
                  className="aspect-[9/16] w-full bg-black object-contain"
                />
              ) : (
                <video
                  src={mediaUrl(a.id)}
                  controls
                  preload="metadata"
                  playsInline
                  className="aspect-[9/16] w-full bg-black object-contain"
                />
              )}
              {selectable && onToggle && (
                <label className="absolute left-2 top-2 flex cursor-pointer items-center gap-1 rounded-md bg-background/85 px-2 py-1 backdrop-blur">
                  <Checkbox
                    checked={order >= 0}
                    onCheckedChange={() => onToggle(a.id)}
                    aria-label={`Select ${a.title || "clip"}`}
                  />
                  {order >= 0 && (
                    <span className="text-xs font-semibold tabular-nums">
                      {order + 1}
                    </span>
                  )}
                </label>
              )}
            </div>
            <CardContent className="space-y-1 p-3">
              <p className="line-clamp-1 text-xs font-medium" title={a.title}>
                {a.title || "Untitled"}
              </p>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="line-clamp-1">{nicheTitle(a.niche_id)}</span>
                <span>
                  {a.duration_sec ? `${Number(a.duration_sec).toFixed(0)}s` : ""}
                </span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// Composition status is tabular (title, clips, created, status, preview),
// so it adopts the template's table anatomy (components/square/ui/table)
// rather than the stacked Card list. No sort/search/pagination toolbar —
// this is a small status list, not the primary campaigns-table clone.
function CompositionList({ compositions }: { compositions: Composition[] }) {
  if (compositions.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No remixes yet — select clips in the Clips tab to create one.
      </p>
    );
  }
  return (
    <div className="rounded-lg border bg-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="text-xs font-medium text-muted-foreground">Title</TableHead>
            <TableHead className="text-xs font-medium text-muted-foreground">Clips</TableHead>
            <TableHead className="text-xs font-medium text-muted-foreground">Created</TableHead>
            <TableHead className="text-xs font-medium text-muted-foreground">Status</TableHead>
            <TableHead className="text-xs font-medium text-muted-foreground">Preview</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {compositions.map((c) => (
            <TableRow key={c.id} className="border-b last:border-0 hover:bg-muted/30">
              <TableCell className="py-3">
                <p className="line-clamp-1 text-sm font-medium max-w-[220px]">
                  {c.title || `Remix ${c.id.slice(0, 8)}`}
                </p>
                {c.error && (
                  <p className="pt-1 text-xs text-destructive line-clamp-1 max-w-[220px]">{c.error}</p>
                )}
              </TableCell>
              <TableCell className="py-3 text-sm text-muted-foreground">
                {c.clip_asset_ids.length}
              </TableCell>
              <TableCell className="py-3 text-sm text-muted-foreground whitespace-nowrap">
                {new Date(c.created_at).toLocaleString()}
              </TableCell>
              <TableCell className="py-3">
                <StatusBadge status={c.status} />
              </TableCell>
              <TableCell className="py-3">
                {c.status === "done" && c.output_asset_id ? (
                  <video
                    src={mediaUrl(c.output_asset_id)}
                    controls
                    preload="metadata"
                    playsInline
                    className="aspect-[9/16] w-16 rounded bg-black object-contain"
                  />
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function StatusBadge({ status }: { status: Composition["status"] }) {
  // Template palette: Draft/Live/Paused/Ended slots mapped onto our real
  // composition states (same technique as square/campaigns-table.tsx).
  const tone =
    status === "done"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900"
      : status === "failed"
        ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400 border-rose-200 dark:border-rose-900"
        : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 border-blue-200 dark:border-blue-900";
  return (
    <Badge variant="outline" className={cn("text-xs font-medium px-2 py-0.5", tone)}>
      {status}
    </Badge>
  );
}
