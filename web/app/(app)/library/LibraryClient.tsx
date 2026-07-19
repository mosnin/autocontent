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

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Clapperboard, Film, Layers, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { clientFetch } from "@/lib/client-fetcher";
import type { Composition, MediaAsset, Niche } from "@/lib/types";

const POLL_MS = 5000;

function mediaUrl(assetId: string): string {
  return `/api/proxy/api/v1/library/${assetId}/media`;
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
    { fallbackData: nicheFilter === "all" ? initialClips : undefined },
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
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
          <p className="text-sm text-muted-foreground">
            Every video and clip you&apos;ve produced — play, sort, remix.
          </p>
        </div>
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
          <TabsTrigger value="finals">
            <Film className="mr-1.5 size-3.5" aria-hidden />
            Final videos
          </TabsTrigger>
          <TabsTrigger value="clips">
            <Layers className="mr-1.5 size-3.5" aria-hidden />
            Clips
          </TabsTrigger>
          <TabsTrigger value="images">
            Images
          </TabsTrigger>
          <TabsTrigger value="remixes">
            <Clapperboard className="mr-1.5 size-3.5" aria-hidden />
            Remixes
          </TabsTrigger>
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
            <Card className="border-primary/40">
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
          {selected.length > 0 && (
            <Card className="border-primary/40">
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
            assets={images ?? []}
            nicheTitle={nicheTitle}
            selectable
            selected={selected}
            onToggle={toggle}
            empty="No images yet — every rendered scene is saved here automatically."
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
          <Card key={a.id} className="overflow-hidden">
            <div className="relative">
              <video
                src={mediaUrl(a.id)}
                controls
                preload="metadata"
                playsInline
                className="aspect-[9/16] w-full bg-black object-contain"
              />
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

function CompositionList({ compositions }: { compositions: Composition[] }) {
  if (compositions.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No remixes yet — select clips in the Clips tab to create one.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {compositions.map((c) => (
        <Card key={c.id}>
          <CardContent className="flex flex-wrap items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
              <p className="line-clamp-1 text-sm font-medium">
                {c.title || `Remix ${c.id.slice(0, 8)}`}
              </p>
              <p className="text-xs text-muted-foreground">
                {c.clip_asset_ids.length} clips ·{" "}
                {new Date(c.created_at).toLocaleString()}
              </p>
              {c.error && (
                <p className="pt-1 text-xs text-destructive">{c.error}</p>
              )}
            </div>
            <StatusBadge status={c.status} />
            {c.status === "done" && c.output_asset_id && (
              <video
                src={mediaUrl(c.output_asset_id)}
                controls
                preload="metadata"
                playsInline
                className="aspect-[9/16] w-28 rounded bg-black object-contain"
              />
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: Composition["status"] }) {
  if (status === "done") return <Badge>done</Badge>;
  if (status === "failed") return <Badge variant="destructive">failed</Badge>;
  return (
    <Badge variant="secondary" className="gap-1">
      <RefreshCw className="size-3 animate-spin" aria-hidden />
      {status}
    </Badge>
  );
}
