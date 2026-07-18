"use client";

// Repurpose a finished article into platform-native social posts via
// POST /articles/{id}/social (one metered LLM call). Lets the user pick
// platforms, generates, and copies each result. Shared between the article
// detail page and /press/repurpose so there is exactly one implementation.

import * as React from "react";
import { toast } from "sonner";
import { Copy, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SOCIAL_PLATFORMS = [
  { key: "twitter", label: "X / Twitter" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
  { key: "newsletter", label: "Newsletter" },
] as const;

type Snippet = { platform: string; body: string; hashtags: string[] };

export function RepurposeCard({
  articleId,
  defaultPlatforms = ["twitter", "linkedin"],
}: {
  articleId: string;
  defaultPlatforms?: string[];
}) {
  const [selected, setSelected] = React.useState<string[]>(defaultPlatforms);
  const [loading, setLoading] = React.useState(false);
  const [snippets, setSnippets] = React.useState<Snippet[] | null>(null);

  const toggle = (key: string) =>
    setSelected((s) =>
      s.includes(key) ? s.filter((k) => k !== key) : [...s, key],
    );

  async function generate() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/proxy/api/v1/articles/${articleId}/social`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ platforms: selected }),
          cache: "no-store",
        },
      );
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(
          res.status === 402
            ? "Daily spend cap reached for this channel."
            : `Couldn't generate posts (${res.status}). ${detail.slice(0, 120)}`,
        );
      }
      const data = (await res.json()) as { snippets: Snippet[] };
      setSnippets(data.snippets);
      if (data.snippets.length === 0) {
        toast.message("No posts came back. Try different platforms.");
      } else {
        const n = data.snippets.length;
        toast.success(`Generated ${n} social ${n === 1 ? "post" : "posts"}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-brand" aria-hidden="true" />
            Repurpose to social
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Turn this article into platform-native posts. One metered
            generation, charged to this channel&apos;s cap.
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Platforms"
        >
          {SOCIAL_PLATFORMS.map((p) => {
            const on = selected.includes(p.key);
            return (
              <button
                key={p.key}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(p.key)}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  on
                    ? "border-brand/40 bg-brand/10 text-brand"
                    : "border-border/60 bg-card/40 text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <Button
          onClick={generate}
          disabled={loading || selected.length === 0}
          className="w-full sm:w-auto"
        >
          <Sparkles
            className={`h-4 w-4 ${loading ? "animate-pulse" : ""}`}
            aria-hidden="true"
          />
          {loading ? "Generating…" : "Generate social posts"}
        </Button>

        {snippets && snippets.length === 0 && (
          <div className="rounded-lg border border-dashed border-border/60 bg-card/30 p-4 text-center text-sm text-muted-foreground">
            No posts came back for the selected platforms. Try a different mix
            and generate again.
          </div>
        )}

        {snippets && snippets.length > 0 && (
          <ul className="space-y-3">
            {snippets.map((s, i) => {
              const full =
                s.body +
                (s.hashtags.length ? `\n\n${s.hashtags.join(" ")}` : "");
              const label =
                SOCIAL_PLATFORMS.find((p) => p.key === s.platform)?.label ??
                s.platform;
              return (
                <li
                  key={`${s.platform}-${i}`}
                  className="rounded-lg border border-border/60 bg-card/40 p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Badge variant="outline" className="font-normal">
                      {label}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copy(full)}
                      aria-label={`Copy ${label} post`}
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      Copy
                    </Button>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-foreground/90">
                    {s.body}
                  </p>
                  {s.hashtags.length > 0 && (
                    <p className="mt-2 text-sm text-brand">
                      {s.hashtags.join(" ")}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
