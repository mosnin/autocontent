"use client";

import * as React from "react";
import { X } from "lucide-react";

import { Skeleton } from "@/components/square/ui/skeleton";
import type { StudioGeneration } from "@/lib/studio/client";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<StudioGeneration["status"], string> = {
  queued: "Queued",
  running: "Running",
  done: "",
  failed: "Failed",
};

function Thumb({ generation }: { generation: StudioGeneration }) {
  const output = generation.outputs[0];
  if (generation.status !== "done" || !output) {
    return (
      <span className="flex size-full items-center justify-center text-[11px] text-muted-foreground">
        {STATUS_LABEL[generation.status] || "—"}
      </span>
    );
  }
  const kind = output.kind ?? "";
  if (kind.startsWith("video")) {
    return <video className="size-full object-cover" muted src={output.url} />;
  }
  if (kind.startsWith("audio")) {
    return (
      <span className="flex size-full items-center justify-center text-[11px] text-muted-foreground">
        Audio
      </span>
    );
  }
  // Presigned object-storage URL — see ResultCanvas.
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt="" className="size-full object-cover" src={output.url} />;
}

/**
 * This studio's runs, newest first. Server-side, so it is the same list on
 * every device and a queued run is still here after a reload.
 */
export function HistoryRail({
  runs,
  isLoading,
  selectedId,
  onSelect,
  onRemove,
  className,
}: {
  runs: StudioGeneration[];
  isLoading?: boolean;
  selectedId?: string | null;
  onSelect: (generation: StudioGeneration) => void;
  onRemove: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      <h2 className="text-sm font-medium">History</h2>

      {isLoading && runs.length === 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton className="aspect-square rounded-md" key={i} />
          ))}
        </div>
      ) : runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing generated here yet.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-2">
          {runs.map((generation) => (
            <li className="relative" key={generation.id}>
              <button
                aria-current={selectedId === generation.id}
                className={cn(
                  "block aspect-square w-full overflow-hidden rounded-md border bg-muted",
                  selectedId === generation.id && "ring-2 ring-foreground",
                )}
                onClick={() => onSelect(generation)}
                title={`${generation.model} · ${new Date(generation.created_at).toLocaleString()}`}
                type="button"
              >
                <Thumb generation={generation} />
              </button>
              <button
                aria-label="Remove from history"
                className="absolute right-1 top-1 rounded bg-background/90 p-0.5 opacity-0 transition-opacity hover:bg-background focus-visible:opacity-100 group-hover:opacity-100 [li:hover_&]:opacity-100"
                onClick={() => onRemove(generation.id)}
                type="button"
              >
                <X aria-hidden className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
