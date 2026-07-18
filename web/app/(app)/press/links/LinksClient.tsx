"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Copy, Link2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LinkOpportunity } from "@/lib/types";

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Couldn't copy");
  }
}

export function LinksClient({ opportunities }: { opportunities: LinkOpportunity[] }) {
  const total = opportunities.reduce((sum, o) => sum + o.suggestions.length, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Internal links</h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          Suggested internal links from every finished article, filtered to
          targets that still exist in your corpus. {total} suggestion
          {total === 1 ? "" : "s"} across {opportunities.length} article
          {opportunities.length === 1 ? "" : "s"}.
        </p>
      </div>

      {opportunities.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="rounded-full bg-muted p-3">
              <Link2 className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold">No link opportunities yet</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              This fills in once you have a few finished articles that
              reference each other. Write more, and the pipeline surfaces the
              cross-links here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {opportunities.map((o) => (
            <Card key={o.article_id}>
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className="min-w-0 truncate text-base">
                  <Link
                    href={`/articles/${o.article_id}`}
                    className="hover:underline underline-offset-4"
                  >
                    {o.title}
                  </Link>
                </CardTitle>
                <Badge variant="outline" className="shrink-0 font-normal">
                  {o.suggestions.length} suggestion
                  {o.suggestions.length === 1 ? "" : "s"}
                </Badge>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {o.suggestions.map((s, i) => (
                    <li
                      key={i}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="truncate text-sm font-medium">{s.anchor}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {s.targetUrl}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {s.score.toFixed(2)}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void copy(
                              `[${s.anchor}](${s.targetUrl})`,
                              "Markdown link",
                            )
                          }
                          aria-label={`Copy link for ${s.anchor}`}
                        >
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          Copy
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
