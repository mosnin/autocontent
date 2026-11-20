"use client";

import { Clapperboard, Image as ImageIcon, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx, Thumb } from "@/design-system";
import { formatRelative } from "@/lib/format";
import type { MediaAsset } from "@/lib/types";

export function mediaUrl(assetId: string): string {
  return `/api/proxy/api/v1/library/${assetId}/media`;
}

export const isImage = (a: Pick<MediaAsset, "kind" | "content_type">) => a.kind === "keyframe" || Boolean(a.content_type?.startsWith("image/"));

export const KIND_WORD: Record<MediaAsset["kind"], string> = { final: "Video", composition: "Remix", clip: "Clip", keyframe: "Image", voiceover: "Voiceover", music: "Music" };

export function formatDuration(sec: string | number | null | undefined): string | null {
  const n = Number(sec);
  if (!sec || !Number.isFinite(n) || n <= 0) return null;
  const s = Math.round(n);
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `0:${String(s).padStart(2, "0")}`;
}

/** Loads the media only once the card scrolls near the viewport; stays a flat surface if it can't load. */
function Poster({ asset }: { asset: MediaAsset }) {
  const box = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLVideoElement & HTMLImageElement>(null);
  const [near, setNear] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const image = isImage(asset);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return setNear(true);
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (setNear(true), io.disconnect()), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // An error can fire before React attaches handlers; check the element too.
  useEffect(() => {
    const el = media.current;
    if (!el) return;
    if (image ? el.complete && el.naturalWidth === 0 : el.error) setFailed(true);
    else if (image ? el.complete && el.naturalWidth > 0 : el.readyState >= 2) setLoaded(true);
  }, [near, image]);

  return (
    <div ref={box} className="absolute inset-0">
      <div className="flex size-full items-center justify-center text-fg-faint [&_svg]:size-5">{image ? <ImageIcon /> : <Clapperboard />}</div>
      {near &&
        !failed &&
        (image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img ref={media} src={mediaUrl(asset.id)} alt="" className={cx("absolute inset-0 size-full object-cover transition-opacity duration-200", loaded ? "opacity-100" : "opacity-0")} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
        ) : (
          <video ref={media} src={`${mediaUrl(asset.id)}#t=0.5`} preload="metadata" muted playsInline className={cx("absolute inset-0 size-full object-cover transition-opacity duration-200", loaded ? "opacity-100" : "opacity-0")} onLoadedData={() => setLoaded(true)} onError={() => setFailed(true)} />
        ))}
    </div>
  );
}

/** One deliverable: a 9:16 thumb, then title and meta beneath. */
export function MediaCard({
  asset,
  playbook,
  selecting,
  order,
  onOpen,
  onToggle,
}: {
  asset: MediaAsset;
  playbook?: string;
  selecting?: boolean;
  /** Position in the remix (0-based), or -1 when not selected. */
  order?: number;
  onOpen?: () => void;
  onToggle?: () => void;
}) {
  const selected = order != null && order >= 0;
  const duration = formatDuration(asset.duration_sec);
  const image = isImage(asset);
  return (
    <div className="group min-w-0">
      <button
        type="button"
        onClick={selecting ? onToggle : onOpen}
        aria-pressed={selecting ? selected : undefined}
        aria-label={selecting ? `${selected ? "Deselect" : "Select"} ${asset.title || "clip"}` : `Open ${asset.title || KIND_WORD[asset.kind]}`}
        className={cx("ds-press block w-full rounded-ds-md text-left", selected && "ring-2 ring-ds-accent ring-offset-2 ring-offset-ds-bg")}
      >
        <Thumb ratio="9/16">
          <Poster asset={asset} />
          {duration && (
            <>
              <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/50 to-transparent" />
              <span className="absolute bottom-1.5 right-2 text-[12px] font-medium text-on-fill tabular">{duration}</span>
            </>
          )}
          {!selecting && !image && (
            <span aria-hidden className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              <span className="flex size-9 items-center justify-center rounded-full bg-black/45 text-on-fill [&_svg]:size-3.5">
                <Play className="translate-x-px fill-current" />
              </span>
            </span>
          )}
          {selecting && (
            <span className={cx("absolute right-2 top-2 flex size-5 items-center justify-center rounded-full text-[12px] font-medium tabular", selected ? "bg-ds-accent text-on-fill" : "border-[1.5px] border-on-fill bg-black/25")}>{selected ? (order ?? 0) + 1 : null}</span>
          )}
        </Thumb>
      </button>
      <div className="mt-2 px-0.5">
        <div className="truncate text-[13px]" title={asset.title}>
          {asset.title || "Untitled"}
        </div>
        <div className="truncate text-[12px] text-fg-muted" suppressHydrationWarning>
          {[KIND_WORD[asset.kind], playbook, formatRelative(asset.created_at)].filter(Boolean).join(" · ")}
        </div>
      </div>
    </div>
  );
}
