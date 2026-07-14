import * as React from "react";

import { cn } from "@/lib/utils";
import { MiniChip, MiniPanel } from "./bits";

const DEBITS = [
  { label: "Short · grinder mistakes", amount: "−$0.48" },
  { label: "Article · espresso machines", amount: "−$0.31" },
  { label: "Voiceover · 42s", amount: "−$0.06" },
];

/**
 * Metered billing at a glance: the credit balance up top, then the
 * morning's three tiny debits, each priced to the cent.
 */
export function CreditsVignette({ className }: { className?: string }) {
  return (
    <MiniPanel className={cn("mx-auto max-w-[340px]", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-400">
            Credit balance
          </p>
          <p className="mt-1 font-mono text-2xl font-semibold tracking-tight text-zinc-900">
            $20.00
          </p>
        </div>
        <MiniChip>cap $10/day</MiniChip>
      </div>
      <ul className="mt-3 divide-y divide-zinc-900/[0.05] border-t border-zinc-900/[0.05]">
        {DEBITS.map((row) => (
          <li
            className="flex items-center justify-between gap-3 py-2"
            key={row.label}
          >
            <p className="truncate text-[11.5px] text-zinc-600">{row.label}</p>
            <p className="shrink-0 font-mono text-[11px] text-zinc-400">
              {row.amount}
            </p>
          </li>
        ))}
      </ul>
    </MiniPanel>
  );
}
