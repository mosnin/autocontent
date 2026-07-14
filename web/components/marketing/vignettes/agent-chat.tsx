import * as React from "react";

import { cn } from "@/lib/utils";
import { warmDot } from "@/components/marketing/system/accent";

/**
 * An agent conversation in three beats: the ask (ink bubble), the
 * tool call it made (mono chip with its declared cost), the reply
 * (white bubble). Floats bare on the scene wash, no panel.
 */
export function AgentChatVignette({ className }: { className?: string }) {
  return (
    <div className={cn("mx-auto w-full max-w-[340px] space-y-2", className)}>
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-zinc-900 px-3.5 py-2 text-[12.5px] leading-snug text-white">
          Draft an article on burr grinders.
        </p>
      </div>
      <div className="flex">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-900/10 bg-white/80 px-2.5 py-1 font-mono text-[10.5px] text-zinc-500 shadow-sm">
          <span className={cn("size-1.5 rounded-full", warmDot)} />
          generate_article · est $0.31
        </span>
      </div>
      <div className="flex">
        <p className="max-w-[85%] rounded-2xl rounded-bl-md border border-zinc-900/[0.06] bg-white px-3.5 py-2 text-[12.5px] leading-snug text-zinc-700 shadow-sm">
          Drafted and queued for review. $3.80 of your $10 cap used today.
        </p>
      </div>
    </div>
  );
}
