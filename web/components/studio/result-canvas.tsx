"use client";

import * as React from "react";

import { Button } from "@/components/square/ui/button";
import { Progress } from "@/components/square/ui/progress";
import type { StudioGeneration, StudioOutput } from "@/lib/studio/client";
import { cn } from "@/lib/utils";

/**
 * Rough progress for a running generation. The providers give us no
 * percentage, so this is elapsed time against the model class's typical
 * run — it advances but never reaches 100% until the row is actually done,
 * so it can't claim a finish that hasn't happened.
 */
function useElapsedProgress(generation: StudioGeneration | null) {
  const [pct, setPct] = React.useState(0);
  const startedAt = generation?.created_at;
  const running =
    generation?.status === "queued" || generation?.status === "running";

  React.useEffect(() => {
    if (!running || !startedAt) {
      setPct(0);
      return;
    }
    const start = new Date(startedAt).getTime();
    const typical = 90_000;
    const tick = () => {
      const elapsed = Date.now() - start;
      setPct(Math.min(95, Math.round((elapsed / typical) * 100)));
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);

  return pct;
}

function OutputView({ output }: { output: StudioOutput }) {
  const kind = output.kind ?? "";
  if (kind.startsWith("video") || output.url.match(/\.(mp4|webm|mov)(\?|$)/i)) {
    return (
      <video
        className="max-h-full max-w-full rounded-md"
        controls
        playsInline
        src={output.url}
      />
    );
  }
  if (kind.startsWith("audio") || output.url.match(/\.(mp3|wav|m4a)(\?|$)/i)) {
    return <audio className="w-full" controls src={output.url} />;
  }
  return (
    // Presigned object-storage URL on a domain we don't configure in
    // next.config images — a plain <img> is the correct element here.
    // eslint-disable-next-line @next/next/no-img-element
    <img alt="" className="max-h-full max-w-full rounded-md" src={output.url} />
  );
}

/**
 * The centre of every studio: whatever the newest run produced, or the
 * state it is in. Empty means empty — a line of text, not a scene.
 */
export function ResultCanvas({
  generation,
  emptyHint,
  actions,
  className,
}: {
  generation: StudioGeneration | null;
  emptyHint: string;
  /** Studio-specific follow-ups (animate, extend, upscale) for a result. */
  actions?: (generation: StudioGeneration) => React.ReactNode;
  className?: string;
}) {
  const pct = useElapsedProgress(generation);

  return (
    <div
      className={cn(
        "flex min-h-[420px] flex-col rounded-lg border bg-card p-4",
        className,
      )}
    >
      {!generation ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">{emptyHint}</p>
        </div>
      ) : generation.status === "failed" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-sm font-medium">This generation failed</p>
          <p className="max-w-prose text-sm text-muted-foreground">
            {generation.error ?? "No reason was recorded."}
          </p>
        </div>
      ) : generation.status !== "done" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="text-sm text-muted-foreground">
            {generation.status === "queued" ? "Queued" : "Generating"} ·{" "}
            {generation.model}
          </p>
          <Progress className="w-56" value={pct} />
        </div>
      ) : (
        <>
          <div className="flex flex-1 flex-wrap items-center justify-center gap-3 overflow-auto">
            {generation.outputs.map((output, i) => (
              <OutputView key={output.url + i} output={output} />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
            <span className="text-xs text-muted-foreground">
              {generation.model} · ${Number(generation.cost_usd).toFixed(3)}
            </span>
            <span className="flex-1" />
            {actions?.(generation)}
            {generation.outputs[0] ? (
              <Button asChild size="sm" variant="outline">
                <a
                  download
                  href={generation.outputs[0].url}
                  rel="noreferrer"
                  target="_blank"
                >
                  Download
                </a>
              </Button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
