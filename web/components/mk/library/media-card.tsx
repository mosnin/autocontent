"use client";

import { Clapperboard, Image as ImageIcon, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatRelative } from "@/lib/format";
import type { MediaAsset } from "@/lib/types";
import { fieldGradient, paletteFor } from "../shader";
import { CheckCircle, cx } from "../ui";

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

/** Loads the media only once the card scrolls near the viewport; falls back to a soft field if it can't load. */
function Poster({ asset }: { asset: MediaAsset }) {
  const box = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLVideoElement & HTMLImageElement>(null);
  const [near, setNear] = useState(false);
  const [failed, setFailed] = useState(false);
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
  }, [near, image]);

  return (
    <div ref={box} className="absolute inset-0">
      {failed || !near ? (
        <div className="flex size-full items-center justify-center" style={{ background: failed ? fieldGradient(paletteFor(asset.title || asset.id)) : undefined }}>
          <span className={cx("flex [&_svg]:size-6", failed ? "text-black/35" : "text-faint")}>{image ? <ImageIcon /> : <Clapperboard />}</span>
        </div>
      ) : image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={media} src={mediaUrl(asset.id)} alt="" className="size-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <video ref={media} src={`${mediaUrl(asset.id)}#t=0.5`} preload="metadata" muted playsInline className="size-full object-cover" onError={() => setFailed(true)} />
      )}
    </div>
  );
}

/** One asset: a 9:16 poster with kind and duration, title and playbook beneath. */
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
        className={cx(
          "press relative block aspect-[9/16] w-full overflow-hidden rounded-[14px] bg-muted outline-none ring-offset-2 ring-offset-background transition-shadow duration-150 focus-visible:ring-2 focus-visible:ring-accent",
          selected && "ring-2 ring-accent",
        )}
      >
        <Poster asset={asset} />
        {/* scrims (raw colour is fine on media) */}
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/55 to-transparent" />
        <span className="absolute left-2 top-2 inline-flex h-5 items-center rounded-full bg-black/45 px-2 text-[11px] font-medium text-white backdrop-blur-sm">{KIND_WORD[asset.kind]}</span>
        {duration && <span className="absolute bottom-2 right-2 text-[11px] font-medium text-white tabular">{duration}</span>}
        {!selecting && !image && (
          <span aria-hidden className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <span className="flex size-11 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm [&_svg]:size-4">
              <Play className="translate-x-px fill-current" />
            </span>
          </span>
        )}
        {selecting && (
          <span className="absolute right-2 top-2 flex items-center">
            {selected ? (
              <span className="t-check flex size-[22px] items-center justify-center rounded-full bg-accent text-[11px] font-medium text-white shadow-pill tabular">{(order ?? 0) + 1}</span>
            ) : (
              <span className="rounded-full bg-black/25 backdrop-blur-sm">
                <CheckCircle done={false} className="size-[22px] text-white" />
              </span>
            )}
          </span>
        )}
      </button>
      <div className="mt-2 px-0.5">
        <div className="truncate text-[13px] font-medium" title={asset.title}>
          {asset.title || "Untitled"}
        </div>
        <div className="truncate text-[12px] text-muted-foreground" suppressHydrationWarning>
          {[playbook, formatRelative(asset.created_at)].filter(Boolean).join(" · ")}
        </div>
      </div>
    </div>
  );
}
