import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DashHeading } from "@/components/hub/dashboard-kit";
import { hubCardClass } from "@/components/hub/primitives";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { Niche, Platform } from "@/lib/types";

export const dynamic = "force-dynamic";

const PLATFORM_LABEL: Record<Platform, string> = {
  tiktok: "TikTok",
  reels: "Reels",
  shorts: "Shorts",
};

// Standalone Niches collection page. Mirrors the dashboard's niche grid,
// but as a pure server-rendered list — each card links to the niche
// detail (`/niches/[id]`) rather than carrying the dashboard's inline
// run/archive controls.
export default async function NichesPage() {
  const niches = await api<Niche[]>("/api/v1/niches");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <DashHeading as="h1" sub="Every niche you run, each its own self-driving pipeline.">
          Niches
        </DashHeading>
        <Button asChild>
          <Link href="/onboarding">
            New niche
          </Link>
        </Button>
      </div>

      {niches.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {niches.map((n) => (
            <NicheCard key={n.id} niche={n} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <Card className={cn(hubCardClass, "border-dashed")}>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <h3 className="text-lg font-semibold">No niches yet</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          Create one to start the pipeline. You can have as many as you want;
          each runs under its own daily spend cap.
        </p>
        <Button asChild>
          <Link href="/onboarding">
            Create your first niche
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function NicheCard({ niche }: { niche: Niche }) {
  return (
    <Card className={cn(hubCardClass, "group flex flex-col transition-colors duration-300 hover:border-brand/30")}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg font-semibold">
            <Link href={`/niches/${niche.id}`} className="hover:underline">
              {niche.title}
            </Link>
          </CardTitle>
          {niche.archived_at && <Badge variant="destructive">Archived</Badge>}
        </div>
        <CardDescription className="line-clamp-2">
          {niche.description}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex-1 space-y-4 pb-3">
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">For:</span> {niche.target_audience}
        </div>

        {niche.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {niche.hashtags.slice(0, 6).map((tag) => (
              <Badge key={tag} variant="secondary" className="font-normal">
                #{tag}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>image: {niche.image_quality}</span>
          <span>video: {niche.video_resolution}</span>
          <span>scenes: {niche.scene_count}</span>
          <span>
            {niche.target_duration_sec}s · {niche.scene_max_duration_sec}s/scene
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {niche.platforms.map((p) => (
            <Badge key={p} variant="outline" className="font-normal">
              {PLATFORM_LABEL[p]}
            </Badge>
          ))}
        </div>
      </CardContent>

      <CardFooter className="flex items-center justify-between pt-0">
        <span className="text-xs text-muted-foreground">own spend cap</span>
        <Button asChild size="sm" variant="ghost">
          <Link href={`/niches/${niche.id}`}>
            Open
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
