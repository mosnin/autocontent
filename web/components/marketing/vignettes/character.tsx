import * as React from "react";

import { cn } from "@/lib/utils";

const SCENES = [
  {
    label: "dawn",
    wash: "bg-[linear-gradient(165deg,#fef3c7_0%,#fecdd3_100%)]",
  },
  {
    label: "day",
    wash: "bg-[linear-gradient(165deg,#e0f2fe_0%,#bae6fd_100%)]",
  },
  {
    label: "dusk",
    wash: "bg-[linear-gradient(165deg,#c7d2fe_0%,#a5b4fc_100%)]",
  },
];

/** One silhouette, unchanged across every scene. */
function Silhouette() {
  return (
    <svg
      aria-hidden
      className="absolute inset-x-0 bottom-0 w-full"
      viewBox="0 0 80 64"
    >
      <g className="fill-zinc-900/75">
        <circle cx={40} cy={22} r={12} />
        <path d="M 12 64 C 15 44 26 37 40 37 C 54 37 65 44 68 64 Z" />
      </g>
    </svg>
  );
}

/**
 * Character consistency: three scene thumbs, dawn to dusk, sharing one
 * identical silhouette. The light changes; the character doesn't.
 */
export function CharacterVignette({ className }: { className?: string }) {
  return (
    <div className={cn("mx-auto w-full max-w-[320px]", className)}>
      <div className="grid grid-cols-3 gap-2">
        {SCENES.map((scene) => (
          <div key={scene.label}>
            <div
              className={cn(
                "relative aspect-[3/4] overflow-hidden rounded-xl shadow-[0_8px_24px_rgba(15,23,42,0.10)] ring-1 ring-inset ring-zinc-900/[0.06]",
                scene.wash,
              )}
            >
              <Silhouette />
            </div>
            <p className="mt-1.5 text-center text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-400">
              {scene.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
