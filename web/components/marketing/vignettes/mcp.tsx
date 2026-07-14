import * as React from "react";

import { cn } from "@/lib/utils";
import { warmBg } from "@/components/marketing/system/accent";
import { CheckGlyph, MiniHeader, MiniPanel } from "./bits";

const TOOLS = [
  { name: "generate_article", cost: "est $0.31" },
  { name: "enqueue_job", cost: "est $0.52" },
  { name: "today_spend", cost: "free" },
];

/**
 * The MCP surface: stacked tool calls, each declaring its cost up
 * front, each carrying the warm declared-cost tick.
 */
export function MCPVignette({ className }: { className?: string }) {
  return (
    <MiniPanel className={cn("mx-auto max-w-[380px]", className)}>
      <MiniHeader meta="every call declares cost" title="MCP tools" />
      <ul className="mt-3 space-y-2">
        {TOOLS.map((tool) => (
          <li
            className="flex items-center justify-between gap-3 rounded-xl border border-zinc-900/[0.05] bg-white/80 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]"
            key={tool.name}
          >
            <p className="truncate font-mono text-[11.5px] text-zinc-800">
              {tool.name}
            </p>
            <span className="flex shrink-0 items-center gap-2">
              <span className="font-mono text-[10.5px] text-zinc-400">
                {tool.cost}
              </span>
              <span
                aria-label="cost declared"
                className={cn(
                  "inline-flex size-4 items-center justify-center rounded-full text-white",
                  warmBg,
                )}
                role="img"
              >
                <CheckGlyph className="size-2.5" />
              </span>
            </span>
          </li>
        ))}
      </ul>
    </MiniPanel>
  );
}
