"use client";

import * as React from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The face of the channel — the generated character sheet every scene is
 * conditioned on. 404s until the first pipeline run creates it, in which
 * case the whole card stays unmounted (no empty frame, no placeholder).
 *
 * While the image streams in we reserve its space with a 9:16 aspect box
 * (the sheet is always composed as a 9:16 image) so the card doesn't jump
 * once the bytes arrive — no cumulative layout shift.
 */
export function CharacterSheetCard({ nicheId }: { nicheId: string }) {
  const [loaded, setLoaded] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  if (failed) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">
          Channel identity
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          The character sheet every scene is kept consistent with.
        </p>
      </CardHeader>
      <CardContent>
        {/* Fixed 9:16 box reserves layout space before the image loads. */}
        <div className="relative mx-auto aspect-[9/16] w-full max-w-xs overflow-hidden rounded-lg border border-border/60">
          {!loaded && (
            <Skeleton className="absolute inset-0 h-full w-full rounded-none" />
          )}
          {/* Proxied stream with Clerk auth; plain img keeps it simple. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt="Generated character sheet for this niche"
            width={720}
            height={1280}
            loading="lazy"
            className={`h-full w-full object-cover transition-opacity duration-300 ${
              loaded ? "opacity-100" : "opacity-0"
            }`}
            onError={() => setFailed(true)}
            onLoad={() => setLoaded(true)}
            src={`/api/proxy/api/v1/niches/${nicheId}/character-sheet`}
          />
        </div>
      </CardContent>
    </Card>
  );
}
