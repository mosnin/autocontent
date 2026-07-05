"use client";

import * as React from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The face of the channel — the generated character sheet every scene is
 * conditioned on. 404s until the first pipeline run creates it, in which
 * case the whole card stays unmounted (no empty frame, no placeholder).
 */
export function CharacterSheetCard({ nicheId }: { nicheId: string }) {
  const [loaded, setLoaded] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  if (failed) return null;

  return (
    <Card className={loaded ? undefined : "hidden"}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">
          Channel identity
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          The character sheet every scene is kept consistent with.
        </p>
      </CardHeader>
      <CardContent>
        {/* Proxied stream with Clerk auth; plain img keeps it simple. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt="Generated character sheet for this niche"
          className="w-full rounded-lg border border-border/60"
          onError={() => setFailed(true)}
          onLoad={() => setLoaded(true)}
          src={`/api/proxy/api/v1/niches/${nicheId}/character-sheet`}
        />
      </CardContent>
    </Card>
  );
}
