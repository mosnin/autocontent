import * as React from "react";

import { cn } from "@/lib/utils";
import { MiniHeader, MiniPanel } from "./bits";

const DAYS = [
  { label: "M", posts: 0, tonight: false },
  { label: "T", posts: 1, tonight: false },
  { label: "W", posts: 0, tonight: false },
  { label: "T", posts: 2, tonight: true },
  { label: "F", posts: 0, tonight: false },
  { label: "S", posts: 1, tonight: false },
  { label: "S", posts: 0, tonight: false },
];

/**
 * The week ahead: seven day cells, three carrying post dots, tonight's
 * slot highlighted in ink with the next post named below.
 */
export function ScheduleVignette({ className }: { className?: string }) {
  return (
    <MiniPanel className={cn("mx-auto max-w-[380px]", className)}>
      <MiniHeader meta="4 posts scheduled" title="This week" />
      <div className="mt-3 grid grid-cols-7 gap-1.5">
        {DAYS.map((day, i) => (
          <div
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-lg py-2",
              day.tonight
                ? "bg-zinc-900 shadow-sm"
                : "border border-zinc-900/[0.05] bg-white/70",
            )}
            key={i}
          >
            <span
              className={cn(
                "text-[10px] font-medium",
                day.tonight ? "text-white" : "text-zinc-400",
              )}
            >
              {day.label}
            </span>
            <span className="flex h-1.5 items-center gap-1">
              {Array.from({ length: day.posts }).map((_, j) => (
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    day.tonight ? "bg-brand" : "bg-zinc-300",
                  )}
                  key={j}
                />
              ))}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-zinc-900/[0.05] bg-white/80 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
        <span className="size-1.5 shrink-0 rounded-full bg-brand" />
        <p className="truncate text-[12px] font-medium text-zinc-800">
          Tonight 9:00 PM
        </p>
        <p className="ml-auto truncate text-[10.5px] text-zinc-400">
          Dial in espresso in 60s
        </p>
      </div>
    </MiniPanel>
  );
}
