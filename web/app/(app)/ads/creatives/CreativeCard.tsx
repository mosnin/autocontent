"use client";

import { toast } from "sonner";
import { Copy } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { AdCreative } from "@/lib/ads-client";

export async function copyCreativeField(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Copy failed");
  }
}

/** One generated ad-copy variant: headline, body, and CTA, each individually
 *  copyable plus a "copy all" for the whole variant. Shared between the
 *  creative studio (/ads/creatives) and the campaign detail page so the
 *  variant card looks identical everywhere it appears. */
export function CreativeCard({ creative }: { creative: AdCreative }) {
  const full = [creative.headline, creative.body, creative.cta]
    .filter(Boolean)
    .join("\n\n");

  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold leading-snug">
            {creative.headline || "Untitled headline"}
          </p>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Copy headline"
            onClick={() => copyCreativeField(creative.headline, "Headline")}
            className="shrink-0"
          >
            <Copy className="size-3.5" aria-hidden />
          </Button>
        </div>

        <div className="flex items-start justify-between gap-2">
          <p className="text-sm text-muted-foreground">{creative.body}</p>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Copy body"
            onClick={() => copyCreativeField(creative.body, "Body")}
            className="shrink-0"
          >
            <Copy className="size-3.5" aria-hidden />
          </Button>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-3">
          <Badge variant="outline">{creative.cta || "No CTA"}</Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={() => copyCreativeField(full, "Variant")}
          >
            <Copy className="size-3.5" aria-hidden />
            Copy all
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
