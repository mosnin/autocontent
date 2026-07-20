"use client";

import * as React from "react";
import useSWR from "swr";

import {
  mediaFileUrl,
  mediaSlotById,
  type MediaTone,
} from "@/lib/media-slots";
import { cn } from "@/lib/utils";

/**
 * A managed image surface. Renders the admin-uploaded image for `id`
 * (see /admin/media) or, while the slot is empty, a rich duotone
 * placeholder scene so the layout never reads as a wireframe.
 */

type ManifestResponse = {
  slots: Record<string, { ext: string; type: string; updatedAt: number }>;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useMediaManifest() {
  return useSWR<ManifestResponse>("/api/media", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  });
}

/** Duotone gradient families for empty slots — saturated but light. */
const TONES: Record<MediaTone, string> = {
  warm: "linear-gradient(135deg,#fde9d2 0%,#fbd1c2 45%,#f9c1cf 100%)",
  sky: "linear-gradient(135deg,#dbeafe 0%,#c7d9fb 50%,#dcd4fa 100%)",
  violet: "linear-gradient(135deg,#ede9fe 0%,#ddd4fb 50%,#f3d3ef 100%)",
  slate: "linear-gradient(135deg,#eef1f6 0%,#dfe5ee 55%,#e6e2f2 100%)",
  rose: "linear-gradient(135deg,#ffe4e6 0%,#fcd0dd 50%,#f7cbea 100%)",
};

const TONE_INK: Record<MediaTone, string> = {
  warm: "text-orange-900/50",
  sky: "text-indigo-900/45",
  violet: "text-violet-900/45",
  slate: "text-slate-700/50",
  rose: "text-rose-900/45",
};

function PlaceholderScene({
  tone,
  label,
  showChip,
}: {
  tone: MediaTone;
  label: string;
  showChip: boolean;
}) {
  return (
    <div
      aria-label={`Image placeholder: ${label}`}
      className="relative h-full w-full overflow-hidden"
      role="img"
      style={{ background: TONES[tone] }}
    >
      {/* Soft abstract composition so the well reads as art, not absence. */}
      <div
        aria-hidden
        className="absolute -left-[12%] top-[8%] size-[55%] rounded-full opacity-50 blur-2xl"
        style={{ background: "rgba(255,255,255,0.9)" }}
      />
      <div
        aria-hidden
        className="absolute -bottom-[18%] -right-[8%] size-[70%] rounded-full opacity-40 blur-3xl"
        style={{ background: "rgba(255,255,255,0.8)" }}
      />
      <svg
        aria-hidden
        className={cn("absolute inset-0 h-full w-full", TONE_INK[tone])}
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 400 250"
      >
        <path
          d="M-20 210 C 80 150, 150 240, 240 170 S 380 120, 430 160"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeOpacity="0.35"
          strokeWidth="2"
        />
        <circle cx="318" cy="64" fill="currentColor" fillOpacity="0.2" r="26" />
        <circle cx="318" cy="64" fill="currentColor" fillOpacity="0.45" r="7" />
      </svg>
      {showChip ? (
        <span className="absolute bottom-3 left-3 rounded-full border border-white/60 bg-white/75 px-2.5 py-1 text-[10.5px] font-medium text-zinc-700 backdrop-blur">
          {label} — add in Admin › Media
        </span>
      ) : null}
    </div>
  );
}

export function MediaSlot({
  id,
  className,
  imgClassName,
  showChip = true,
  alt,
}: {
  id: string;
  className?: string;
  imgClassName?: string;
  /** Hide the "add in Admin" chip (e.g. tiny cards). */
  showChip?: boolean;
  alt?: string;
}) {
  const slot = mediaSlotById(id);
  const { data } = useMediaManifest();
  const entry = data?.slots?.[id];

  return (
    <div className={cn("relative h-full w-full overflow-hidden", className)}>
      {entry ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={alt ?? slot?.label ?? id}
          className={cn(
            "h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]",
            imgClassName,
          )}
          src={mediaFileUrl(id, entry.updatedAt)}
        />
      ) : (
        <PlaceholderScene
          label={slot?.label ?? id}
          showChip={showChip}
          tone={slot?.tone ?? "slate"}
        />
      )}
    </div>
  );
}
