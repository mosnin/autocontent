"use client";

import { Instagram, Music2, Youtube, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useRunConfirm } from "@/components/run-confirm-dialog";
import type { Niche, Platform } from "@/lib/types";

const PLATFORM_META: Record<Platform, { label: string; icon: LucideIcon }> = {
  tiktok: { label: "TikTok", icon: Music2 },
  reels: { label: "Reels", icon: Instagram },
  shorts: { label: "Shorts", icon: Youtube },
};

export function NicheRunButtons({ niche }: { niche: Niche }) {
  const { openRunConfirm } = useRunConfirm();

  if (niche.platforms.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        Run now
      </span>
      {niche.platforms.map((p) => {
        const meta = PLATFORM_META[p];
        const Icon = meta?.icon;
        return (
          <Button
            key={p}
            size="sm"
            variant="outline"
            className="focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2"
            onClick={() => openRunConfirm({ nicheId: niche.id, platform: p })}
          >
            {Icon && <Icon className="size-3.5" />}
            {meta?.label ?? p}
          </Button>
        );
      })}
    </div>
  );
}
