"use client";

// Curated visual-style presets: swatch cards the user can apply to a
// niche instead of writing art direction from scratch. When a preset
// ships with a reference video (a real render in that style) it plays
// inline on hover-tap so the user can *see* the style before choosing.

import * as React from "react";
import useSWR from "swr";
import { Check } from "lucide-react";

import { clientFetch } from "@/lib/client-fetcher";
import { cn } from "@/lib/utils";
import type { StylePreset } from "@/lib/types";

export function StylePresetPicker({
  onApply,
  appliedId,
  className,
}: {
  onApply: (preset: StylePreset) => void;
  appliedId?: string | null;
  className?: string;
}) {
  const { data: presets } = useSWR<StylePreset[]>(
    "/api/v1/style-presets",
    clientFetch,
    { revalidateOnFocus: false },
  );

  if (!presets?.length) return null;

  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-sm text-muted-foreground">
        Or start from a preset style
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {presets.map((p) => {
          const applied = appliedId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onApply(p)}
              aria-pressed={applied}
              className={cn(
                "group relative overflow-hidden rounded-lg border text-left",
                "transition-colors focus-visible:outline-none focus-visible:ring-2",
                applied
                  ? "border-primary ring-1 ring-primary"
                  : "border-border/60 hover:border-foreground/30",
              )}
            >
              {p.reference_video_url ? (
                <video
                  src={p.reference_video_url}
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                  onMouseLeave={(e) => e.currentTarget.pause()}
                  className="aspect-[9/16] max-h-24 w-full object-cover"
                />
              ) : (
                <div
                  aria-hidden
                  className="h-14 w-full"
                  style={{ background: p.swatch }}
                />
              )}
              <div className="space-y-0.5 p-2">
                <p className="flex items-center gap-1 text-xs font-medium">
                  {applied && <Check className="size-3 text-primary" aria-hidden />}
                  {p.name}
                </p>
                <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                  {p.tagline}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
