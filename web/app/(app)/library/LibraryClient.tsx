"use client";

// Media library: every pipeline render and Content Studio result. Filter
// by kind (image/video) and source (pipeline/studio), page through the
// keyset-cursor envelope with "load more", and act on any item (view
// full, send to Studio, delete).

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, MoreVertical, Trash2, Wand2 } from "lucide-react";

import { useConfirm } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  deleteMedia,
  fetchMediaAsset,
  fetchMediaPage,
  humanizeStudioError,
  mediaFileUrl,
  type MediaAsset,
  type MediaAssetPage,
  type MediaKind,
  type MediaSource,
} from "@/lib/studio-client";

type KindFilter = "all" | "image" | "video";
type SourceFilter = "all" | "pipeline" | "studio";

function useLibraryPages(
  kind: MediaKind | undefined,
  source: MediaSource | undefined,
  initialPage: MediaAssetPage | null,
) {
  const isDefault = kind === undefined && source === undefined;
  const [items, setItems] = React.useState<MediaAsset[]>(
    isDefault && initialPage ? initialPage.items : [],
  );
  const [loading, setLoading] = React.useState(!(isDefault && initialPage));
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(
    isDefault && initialPage ? initialPage.next_cursor !== null : true,
  );
  const [error, setError] = React.useState<string | null>(null);
  const cursorRef = React.useRef<string | null>(
    isDefault && initialPage ? initialPage.next_cursor : null,
  );
  const reqId = React.useRef(0);
  const skipFirst = React.useRef(isDefault && !!initialPage);

  const fetchPage = React.useCallback(
    async (reset: boolean) => {
      const id = ++reqId.current;
      if (reset) {
        setLoading(true);
        cursorRef.current = null;
      } else {
        setLoadingMore(true);
      }
      setError(null);
      try {
        const page = await fetchMediaPage({
          kind,
          source,
          cursor: reset ? null : cursorRef.current,
          limit: 48,
        });
        if (id !== reqId.current) return;
        setItems((prev) => (reset ? page.items : [...prev, ...page.items]));
        cursorRef.current = page.next_cursor;
        setHasMore(page.next_cursor !== null);
      } catch (e) {
        if (id !== reqId.current) return;
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (id !== reqId.current) return;
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [kind, source],
  );

  React.useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    void fetchPage(true);
  }, [fetchPage]);

  return {
    items,
    loading,
    loadingMore,
    hasMore,
    error,
    loadMore: () => void fetchPage(false),
    removeItem: (id: string) => setItems((prev) => prev.filter((i) => i.id !== id)),
  };
}

export function LibraryClient({ initialPage }: { initialPage: MediaAssetPage | null }) {
  const confirm = useConfirm();
  const searchParams = useSearchParams();

  const [kindFilter, setKindFilter] = React.useState<KindFilter>("all");
  const [sourceFilter, setSourceFilter] = React.useState<SourceFilter>("all");
  const [viewing, setViewing] = React.useState<MediaAsset | null>(null);

  const { items, loading, loadingMore, hasMore, error, loadMore, removeItem } =
    useLibraryPages(
      kindFilter === "all" ? undefined : kindFilter,
      sourceFilter === "all" ? undefined : sourceFilter,
      initialPage,
    );

  // `?open=<id>` (set by the Studio "open in library" action) auto-opens
  // that asset's full-view dialog, fetching it directly if it isn't on
  // the currently loaded/filtered page.
  const openParam = searchParams.get("open");
  const openedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!openParam || openedRef.current === openParam) return;
    openedRef.current = openParam;
    const found = items.find((i) => i.id === openParam);
    if (found) {
      setViewing(found);
      return;
    }
    fetchMediaAsset(openParam)
      .then((asset) => setViewing(asset))
      .catch(() => {
        // Asset gone or not ours — silently ignore, nothing to show.
      });
  }, [openParam, items]);

  async function onDelete(asset: MediaAsset) {
    const ok = await confirm({
      title: "Delete this asset?",
      description: "It's removed from the library. This can't be undone.",
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteMedia(asset.id);
      removeItem(asset.id);
      if (viewing?.id === asset.id) setViewing(null);
      toast.success("Deleted");
    } catch (e) {
      toast.error(humanizeStudioError(e));
    }
  }

  const filtered = kindFilter === "all" && sourceFilter === "all";

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <h1 className="text-3xl font-semibold tracking-tight">Library</h1>
        <p className="max-w-xl text-[15px] text-muted-foreground">
          Every render and Content Studio result, in one place.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={kindFilter} onValueChange={(v) => setKindFilter(v as KindFilter)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="image">Images</TabsTrigger>
            <TabsTrigger value="video">Videos</TabsTrigger>
          </TabsList>
        </Tabs>

        <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as SourceFilter)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="pipeline">Pipeline</SelectItem>
            <SelectItem value="studio">Studio</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {loading ? (
        <LibraryGridSkeleton />
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-20 text-center">
            <h3 className="text-lg font-semibold">Nothing here yet</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              {filtered
                ? "Renders and Studio results land here."
                : "No media matches this filter."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {items.map((asset) => (
              <LibraryTile
                key={asset.id}
                asset={asset}
                onView={() => setViewing(asset)}
                onDelete={() => onDelete(asset)}
              />
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading…
                  </>
                ) : (
                  "Load more"
                )}
              </Button>
            </div>
          )}
        </>
      )}

      <AssetDialog asset={viewing} onOpenChange={(v) => !v && setViewing(null)} onDelete={onDelete} />
    </div>
  );
}

function LibraryTile({
  asset,
  onView,
  onDelete,
}: {
  asset: MediaAsset;
  onView: () => void;
  onDelete: () => void;
}) {
  const src = mediaFileUrl(asset.id);
  return (
    <div className="group relative overflow-hidden rounded-lg border border-border/60 bg-card/40">
      <button
        type="button"
        onClick={onView}
        className="block aspect-square w-full bg-muted/40"
        aria-label="View full"
      >
        {asset.kind === "video" ? (
          <video
            src={src}
            muted
            loop
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
            onMouseEnter={(e) => void e.currentTarget.play()}
            onMouseLeave={(e) => {
              e.currentTarget.pause();
              e.currentTarget.currentTime = 0;
            }}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="h-full w-full object-cover" />
        )}
      </button>
      <Badge variant="secondary" className="pointer-events-none absolute left-2 top-2 capitalize">
        {asset.source}
      </Badge>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute right-2 top-2 bg-black/40 text-white opacity-0 hover:bg-black/60 hover:text-white focus-visible:opacity-100 group-hover:opacity-100"
            aria-label="Actions"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onView}>View full</DropdownMenuItem>
          {asset.kind === "image" && (
            <DropdownMenuItem asChild>
              <Link href={`/studio?source=${asset.id}`}>
                <Wand2 className="h-4 w-4" />
                Send to Studio
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={onDelete}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function AssetDialog({
  asset,
  onOpenChange,
  onDelete,
}: {
  asset: MediaAsset | null;
  onOpenChange: (v: boolean) => void;
  onDelete: (asset: MediaAsset) => void;
}) {
  return (
    <Dialog open={!!asset} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {asset && (
          <>
            <DialogHeader>
              <DialogTitle className="capitalize">
                {asset.kind} · {asset.source}
              </DialogTitle>
              <DialogDescription>
                Created {new Date(asset.created_at).toLocaleString()}
              </DialogDescription>
            </DialogHeader>
            <div className="overflow-hidden rounded-lg border bg-black">
              {asset.kind === "video" ? (
                <video
                  src={mediaFileUrl(asset.id)}
                  controls
                  className="max-h-[50vh] w-full object-contain"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaFileUrl(asset.id)}
                  alt=""
                  className="max-h-[50vh] w-full object-contain"
                />
              )}
            </div>
            <div className="space-y-1.5 text-sm">
              {asset.meta.model && (
                <p>
                  <span className="text-muted-foreground">Model:</span>{" "}
                  <span className="font-mono text-xs">{asset.meta.model}</span>
                </p>
              )}
              {asset.meta.prompt && (
                <p>
                  <span className="text-muted-foreground">Prompt:</span>{" "}
                  {String(asset.meta.prompt)}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              {asset.kind === "image" && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/studio?source=${asset.id}`}>Send to Studio</Link>
                </Button>
              )}
              <Button variant="destructive" size="sm" onClick={() => onDelete(asset)}>
                Delete
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LibraryGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {Array.from({ length: 10 }).map((_, i) => (
        <Skeleton key={i} className="aspect-square rounded-lg" />
      ))}
    </div>
  );
}
