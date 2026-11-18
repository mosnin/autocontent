"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { EmptyLine, Section, StatusBadge, type StatusTone } from "@/design-system";
import { formatDate } from "@/lib/format";
import type { Evidence, MemoryLearning } from "./types";

const STATUS: Record<MemoryLearning["status"], { title: string; label: string; tone: StatusTone }> = {
  supported: { title: "What worked", label: "Supported", tone: "positive" },
  refuted: { title: "What didn't", label: "Refuted", tone: "negative" },
  hypothesis: { title: "Still testing", label: "Hypothesis", tone: "neutral" },
};

const percent = (lift: number): string => `${lift > 0 ? "+" : ""}${Math.round(lift * 100)}%`;

function evidenceNumbers(e: Evidence): string {
  const parts: string[] = [];
  if (e.metric && e.value !== undefined) parts.push(`${e.metric} ${e.value}`);
  if (e.lift !== undefined) parts.push(percent(e.lift));
  if (e.n !== undefined) parts.push(`n=${e.n}`);
  if (e.window) parts.push(e.window);
  return parts.join(" · ");
}

/** Learnings grouped by verdict; each opens to its evidence (ADR 0010: a learning always carries it). */
export function Learnings({ learnings }: { learnings: MemoryLearning[] }) {
  const [open, setOpen] = useState<string | null>(learnings[0]?.id ?? null);
  if (learnings.length === 0) return <EmptyLine>No learnings yet. They appear once posts and ads have results to compare.</EmptyLine>;
  return (
    <>
      {(["supported", "refuted", "hypothesis"] as const).map((status) => {
        const rows = learnings.filter((l) => l.status === status);
        if (rows.length === 0) return null;
        return (
          <Section key={status} title={STATUS[status].title}>
            <ul className="divide-y divide-hairline overflow-hidden rounded-ds-lg border border-hairline bg-surface">
              {rows.map((l) => {
                const isOpen = open === l.id;
                const panel = `learning-${l.id}`;
                return (
                  <li key={l.id}>
                    <button type="button" onClick={() => setOpen(isOpen ? null : l.id)} aria-expanded={isOpen} aria-controls={panel} className="flex w-full items-start gap-3 px-3.5 py-2.5 text-left -outline-offset-2 hover:bg-surface-2">
                      <span className="min-w-0 flex-1 break-words text-[13px] text-fg">{l.claim}</span>
                      <StatusBadge tone={STATUS[status].tone}>{STATUS[status].label}</StatusBadge>
                      <ChevronDown aria-hidden className={`mt-0.5 size-3.5 shrink-0 text-fg-faint ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                    {isOpen && (
                      <div id={panel} className="border-t border-hairline bg-surface-2 px-3.5 py-3 text-[12.5px]">
                        <div className="text-fg-faint">Evidence · updated {formatDate(l.updated_at)}</div>
                        <ul className="mt-1.5 space-y-1">
                          {l.evidence.map((e, i) => (
                            <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                              <span className="min-w-0 break-words text-fg-muted">{e.label}</span>
                              <span className="shrink-0 text-fg-faint tabular">{evidenceNumbers(e) || e.kind}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>
        );
      })}
    </>
  );
}
