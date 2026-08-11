"use client";

import * as React from "react";
import useSWR from "swr";

import { mediaFileUrl, mediaSlotById } from "@/lib/media-slots";
import { cn } from "@/lib/utils";

/**
 * A managed image surface. Renders the admin-uploaded image for `id`
 * (see /admin/media) or, while the slot is empty, a flat tagged
 * placeholder surface.
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

/**
 * Empty-slot rendering: a plain flat surface with a small text tag —
 * no gradients, no shapes, no fake art. It should read as "media goes
 * here", nothing more.
 */
function PlaceholderScene({
  label,
  showChip,
}: {
  label: string;
  showChip: boolean;
}) {
  return (
    <div
      aria-label={`Image placeholder: ${label}`}
      className="relative flex h-full w-full items-center justify-center bg-zinc-100"
      role="img"
    >
      {showChip ? (
        <span className="max-w-[85%] truncate rounded border border-zinc-200 bg-white px-2 py-1 font-mono text-[10px] text-zinc-400">
          {label} — Admin › Media
        </span>
      ) : (
        <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-300">
          media
        </span>
      )}
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
        <PlaceholderScene label={slot?.label ?? id} showChip={showChip} />
      )}
    </div>
  );
}
