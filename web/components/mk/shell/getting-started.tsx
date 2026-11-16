"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Shader } from "../shader";
import { CheckCircle, cx } from "../ui";

export interface SetupStep {
  id: string;
  label: string;
  detail: string;
  href: string;
  done: boolean;
}

/** "Getting started n of 5": a popover with real-data steps; the next step shows its own shader. */
export function GettingStarted({ steps, children, onNavigate }: { steps: SetupStep[]; children: ReactNode; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const next = steps.find((s) => !s.done);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative mt-2">
      <button type="button" className="press w-full" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {children}
      </button>
      {open && (
        <div className="t-pop absolute bottom-full left-0 z-50 mb-2 w-[300px] overflow-hidden rounded-[20px] border border-border bg-card shadow-float" style={{ ["--origin" as string]: "bottom left" }}>
          <div className="px-4 pb-2 pt-3.5">
            <div className="text-[14px] font-medium">Getting started</div>
            <div className="text-[13px] text-muted-foreground">
              {steps.filter((s) => s.done).length} of {steps.length} done. Each step makes Marketer more useful.
            </div>
          </div>
          <ul className="px-2 pb-2">
            {steps.map((s) => (
              <li key={s.id}>
                <Link href={s.href} onClick={() => (setOpen(false), onNavigate?.())} className={cx("press block rounded-[14px] p-2 hover:bg-muted/60", s === next && "bg-subtle")}>
                  {s === next && <div className="mb-2 h-16 overflow-hidden rounded-[10px]"><Shader palette="sky" /></div>}
                  <span className="flex items-start gap-2.5">
                    <CheckCircle done={s.done} className="mt-px" />
                    <span className="min-w-0">
                      <span className={cx("block text-[14px]", s.done ? "text-muted-foreground line-through" : "font-medium")}>{s.label}</span>
                      {!s.done && <span className="block text-[13px] text-muted-foreground">{s.detail}</span>}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
