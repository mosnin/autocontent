"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { ButtonLink, cx, EmptyLine, List, LoadMore, Section, StatusBadge, Time, usePaged } from "@/design-system";
import { titleCase } from "@/lib/format";
import type { DecisionEntry, DecisionPage } from "@/lib/workspace";

/** The decision points people can read about, in their words. Unknown points fall back to their id. */
const POINT: Record<string, { label: string; about: string }> = {
  routing: { label: "Who should handle a request", about: "Picks the agent a request goes to." },
  approval_risk: { label: "How risky an action is", about: "Can raise an action's risk so a person reviews it. It can never lower it." },
  memory_gate: { label: "What's worth remembering", about: "Decides whether something from a conversation is kept." },
  autopilot: { label: "What to propose next", about: "Suggests the next piece of work when nothing is queued." },
  hook_quality: { label: "Is the hook good enough", about: "Holds or regenerates a weak or risky opening line." },
  budget_change: { label: "Should the budget change", about: "Holds a budget change when tracking looks broken." },
};
export const pointLabel = (point: string) => POINT[point]?.label ?? titleCase(point.replace(/[.:\-]/g, " "));

const MODE: Record<string, { label: string; about: string }> = {
  enforce: { label: "Enforced", about: "The model's judgment was applied." },
  shadow: { label: "Shadow", about: "The model judged, but today's rule made the call. Logged so the two can be compared." },
  off: { label: "Off", about: "No model was asked; today's rule made the call." },
};

const pct = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? `${Math.round(n * 100)}%` : null);

/** One model answer in words: "Yes · 82% sure", "media-buyer · 91% sure". */
export function describeAnswer(answer: unknown): string {
  if (answer === null || answer === undefined) return "No answer";
  if (typeof answer !== "object") return String(answer);
  const a = answer as Record<string, unknown>;
  if (a.type === "yesno" && typeof a.probability === "number") {
    const yes = a.probability >= 0.5;
    return `${yes ? "Yes" : "No"} · ${pct(yes ? a.probability : 1 - a.probability)} sure`;
  }
  if (typeof a.choice === "string") return `${titleCase(a.choice.replace(/-/g, " "))}${pct(a.confidence) ? ` · ${pct(a.confidence)} sure` : ""}`;
  const value = a.value ?? a.level ?? a.answer;
  if (value !== undefined && typeof value !== "object") return `${String(value)}${pct(a.confidence ?? a.probability) ? ` · ${pct(a.confidence ?? a.probability)} sure` : ""}`;
  return JSON.stringify(answer).slice(0, 120);
}

const action = (s: string | null | undefined) => (s ? titleCase(s.replace(/[.:\-]/g, " ")) : "—");

function DecisionRow({ d }: { d: DecisionEntry }) {
  const [open, setOpen] = useState(false);
  const mode = MODE[d.mode] ?? { label: titleCase(d.mode), about: "" };
  const answers = Object.entries(d.answers ?? {});
  const disagreed = Boolean(d.table_action && d.rule_action && d.table_action !== d.rule_action);
  const panel = `decision-${d.id}`;
  const ask = `/sessions/new?q=${encodeURIComponent(`About the "${pointLabel(d.point)}" decision that ended in "${action(d.action_taken)}"${d.subject_kind ? ` on ${d.subject_kind.replace(/_/g, " ")}${d.subject_id ? ` ${d.subject_id}` : ""}` : ""}: I think it was wrong. Here's what should have happened: `)}`;
  return (
    <div>
      <button type="button" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((v) => !v)} className="flex min-h-12 w-full items-center gap-3 px-3.5 py-2.5 text-left -outline-offset-2 hover:bg-surface-2">
        <ChevronRight aria-hidden className={cx("size-3.5 shrink-0 text-fg-muted transition-transform duration-200", open && "rotate-90")} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px]">{pointLabel(d.point)}</span>
          <span className="block text-[12px] text-fg-muted sm:truncate">
            {action(d.action_taken)}
            {d.subject_kind && ` · ${titleCase(d.subject_kind)}`}
            {/* On a phone the badges don't fit beside the title, so the same facts read as words. */}
            <span className="sm:hidden">
              {` · ${mode.label}`}
              {d.fallback_used && " · fallback used"}
              {d.correction && " · corrected"}
            </span>
          </span>
        </span>
        <span className="hidden shrink-0 items-center gap-3 sm:flex">
          {d.correction && <StatusBadge tone="accent">Corrected</StatusBadge>}
          {d.fallback_used && <StatusBadge tone={d.mode === "enforce" ? "attention" : "neutral"}>Fallback used</StatusBadge>}
          <StatusBadge tone={d.mode === "enforce" ? "positive" : "neutral"}>{mode.label}</StatusBadge>
        </span>
        <Time iso={d.created_at} className="shrink-0 whitespace-nowrap text-[12px] text-fg-muted tabular" />
      </button>
      {open && (
        <div id={panel} className="space-y-3 border-t border-hairline bg-surface-2 px-3.5 py-3 text-[12.5px]">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <div>
              <dt className="text-fg-muted">Action taken</dt>
              <dd className="text-fg">{action(d.action_taken)}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">Mode</dt>
              <dd className="text-fg">
                {mode.label}
                {mode.about && <span className="text-fg-muted"> · {mode.about}</span>}
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted">Today&apos;s rule said</dt>
              <dd className="text-fg">{action(d.rule_action)}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">The model&apos;s answers said</dt>
              <dd className={disagreed ? "text-attention" : "text-fg"}>
                {action(d.table_action)}
                {disagreed && " · differs from the rule"}
              </dd>
            </div>
            {d.fallback_used && (
              <div className="sm:col-span-2">
                <dt className="text-fg-muted">Why the fallback</dt>
                <dd className="text-fg">{d.reason ? titleCase(d.reason) : d.mode === "enforce" ? "The model didn't answer in time, so the safe default applied." : "In this mode the rule always makes the call."}</dd>
              </div>
            )}
          </dl>
          {answers.length > 0 && (
            <div>
              <div className="text-fg-muted">What the model judged</div>
              <ul className="mt-1 space-y-1">
                {answers.map(([q, a]) => (
                  <li key={q} className="flex flex-wrap justify-between gap-x-4">
                    <span className="text-fg">{titleCase(q)}</span>
                    <span className="text-fg-muted tabular">{describeAnswer(a)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {d.correction && (
            <div>
              <div className="text-fg-muted">Correction on file</div>
              <p className="text-fg">{typeof d.correction.note === "string" ? d.correction.note : typeof d.correction.action === "string" ? action(d.correction.action) : JSON.stringify(d.correction).slice(0, 200)}</p>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-fg-muted">{POINT[d.point]?.about}</span>
            <ButtonLink href={ask} size="sm">
              This was wrong
            </ButtonLink>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The caller's decision log: each point where a model judged something, what
 * was done, whether the rule-based fallback made the call, the mode and the
 * time. Read-only here; "This was wrong" opens a session so Marketer records
 * the correction.
 */
export function DecisionsList({ decisions, basePath, cursor }: { decisions: DecisionPage | null | undefined; basePath: string; cursor?: string | null }) {
  const items = decisions?.items ?? [];
  const { shown, total, hasMore, more } = usePaged(items, 25);
  if (!decisions) return <EmptyLine>Couldn&apos;t load the decision log. Try again in a moment.</EmptyLine>;
  if (items.length === 0)
    return (
      <EmptyLine action={cursor ? <ButtonLink href={`${basePath}?tab=decisions`} size="sm">Back to latest</ButtonLink> : undefined}>
        {cursor ? "Nothing earlier." : "No decisions logged. Decision models are off, so every call is made by today's rules."}
      </EmptyLine>
    );
  const fallbacks = items.filter((d) => d.fallback_used).length;
  return (
    <>
      <Section title={`Decisions · ${items.length}`} action={<span className="text-[12px] text-fg-muted tabular">{fallbacks} used the fallback</span>}>
        <div className="space-y-3">
          <List>
            {shown.map((d) => (
              <DecisionRow key={d.id} d={d} />
            ))}
          </List>
          <LoadMore shown={shown.length} total={total} onMore={more} noun="decisions" />
        </div>
      </Section>
      {!hasMore && (
        <div className="flex justify-center">
          {decisions.next_cursor ? <ButtonLink href={`${basePath}?tab=decisions&cursor=${encodeURIComponent(decisions.next_cursor)}`}>Load older</ButtonLink> : <span className="text-[12px] text-fg-muted">That&apos;s everything.</span>}
        </div>
      )}
    </>
  );
}
