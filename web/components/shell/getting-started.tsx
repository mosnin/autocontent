"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { SidebarProgress, StepMark, useOutside } from "@/design-system";

export interface SetupStep {
  id: string;
  label: string;
  detail: string;
  href: string;
  done: boolean;
}

/** "Getting started n of 5" (ref 05). Opens the steps; hides once all are done. */
export function GettingStarted({ steps, onNavigate }: { steps: SetupStep[]; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, open, () => setOpen(false));
  const done = steps.filter((s) => s.done).length;
  if (done >= steps.length) return null;
  return (
    <div ref={ref} className="relative pt-1.5">
      <SidebarProgress label="Getting started" done={done} total={steps.length} onClick={() => setOpen((v) => !v)} />
      {open && (
        <div className="ds-pop absolute bottom-full left-0 z-50 mb-1.5 w-[280px] rounded-ds-lg border border-hairline bg-overlay p-1.5 shadow-ds-float" style={{ ["--origin" as string]: "bottom left" }}>
          <div className="px-2 pb-1.5 pt-1 text-[12px] text-fg-faint">
            {done} of {steps.length} done
          </div>
          {steps.map((s) => (
            <Link key={s.id} href={s.href} onClick={() => (setOpen(false), onNavigate?.())} className="flex items-start gap-2.5 rounded-ds-sm px-2 py-1.5 hover:bg-surface-2">
              <span className="mt-[2px]">
                <StepMark state={s.done ? "done" : "todo"} />
              </span>
              <span className="min-w-0">
                <span className={s.done ? "block text-[13px] text-fg-faint line-through" : "block text-[13px] text-fg"}>{s.label}</span>
                {!s.done && <span className="block text-[12px] text-fg-muted">{s.detail}</span>}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
