"use client";

import { Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useRunConfirm } from "@/components/run-confirm-dialog";
import type { Niche, Platform } from "@/lib/types";

const PLATFORM_LABEL: Record<Platform, string> = {
  tiktok: "TikTok",
  reels: "Reels",
  shorts: "Shorts",
};

export function NicheRunButtons({ niche }: { niche: Niche }) {
  const { openRunConfirm } = useRunConfirm();

  if (niche.platforms.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {niche.platforms.map((p) => (
        <Button
          key={p}
          size="sm"
          variant="outline"
          onClick={() => openRunConfirm({ nicheId: niche.id, platform: p })}
        >
          <Play className="h-3.5 w-3.5" />
          Run on {PLATFORM_LABEL[p]}
        </Button>
      ))}
    </div>
  );
}
