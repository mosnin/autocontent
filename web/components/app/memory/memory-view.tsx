"use client";

import { Brain, ChevronDown, FileQuestion } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AskPill, Button, Callout, Column, ConfirmModal, CountBadge, EmptyLine, Modal, Notice, PageHeader, PlanCard, Section, Segmented, StatusBadge, Textarea, useAllowed } from "@/design-system";
import { formatDate } from "@/lib/format";
import { confirmFact, correctFact, fetchHistory, forgetFact } from "./client";
import { Learnings } from "./learnings";
import { RecallView } from "./recall";
import { ENTITY_GROUPS, factText, type MemoryFact, type MemoryLearning, predicateLabel, type RecallPage, type RecallSettings, sourceLabel, sourceRef } from "./types";

type Tab = "facts" | "review" | "learnings" | "personal" | "team";

/** Recall (Supermemory) data for the Personal and Team tabs; null when it could not be loaded. */
export interface RecallData {
  settings: RecallSettings | null;
  personal: RecallPage | null;
  team: RecallPage | null;
}

const ASK = `/sessions/new?q=${encodeURIComponent("What do you know about my business, and what are you unsure about?")}`;

const message = (e: unknown): string => (e instanceof Error && e.message ? e.message : "Something went wrong");

/** Everything the preview needs to behave like the page without an API: the history of each fixture fact. */
export interface MemoryPreview {
  history: Record<string, MemoryFact[]>;
}

/**
 * Memory (ref 07, column md): what Marketer knows, grouped by what it is about. Each fact opens to show where it
 * came from and what it said before; the person can confirm, correct or forget it. Learnings carry their evidence.
 */
export function MemoryView({ facts: initial, learnings, recall, loadFailed, preview, initialTab = "facts", initialOpen }: { facts: MemoryFact[]; learnings: MemoryLearning[]; recall?: RecallData; loadFailed?: boolean; preview?: MemoryPreview; initialTab?: Tab; initialOpen?: string }) {
  const router = useRouter();
  const canConfirm = useAllowed("memory:confirm");
  const canReadTeam = useAllowed("memory:read");
  const [facts, setFacts] = useState(initial);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [open, setOpen] = useState<string | null>(initialOpen ?? null);
  const [history, setHistory] = useState<Record<string, MemoryFact[] | "loading" | "failed">>(preview?.history ?? {});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [forgetting, setForgetting] = useState<MemoryFact | null>(null);
  const [correcting, setCorrecting] = useState<MemoryFact | null>(null);
  const [draft, setDraft] = useState("");

  const current = useMemo(() => facts.filter((f) => !f.pending && !f.invalid_at), [facts]);
  const pending = useMemo(() => facts.filter((f) => f.pending && !f.invalid_at), [facts]);
  const groups = useMemo(() => ENTITY_GROUPS.map((g) => ({ ...g, subjects: bySubject(current.filter((f) => f.subject_type === g.type)) })).filter((g) => g.subjects.length > 0), [current]);

  function toggle(fact: MemoryFact) {
    const next = open === fact.id ? null : fact.id;
    setOpen(next);
    if (!next || history[fact.id] !== undefined) return;
    if (preview) return setHistory((h) => ({ ...h, [fact.id]: [fact] }));
    setHistory((h) => ({ ...h, [fact.id]: "loading" }));
    fetchHistory(fact.id)
      .then((items) => setHistory((h) => ({ ...h, [fact.id]: items })))
      .catch(() => setHistory((h) => ({ ...h, [fact.id]: "failed" })));
  }

  /** Run one change, then apply it to the list. In the preview the request is skipped and only the list changes. */
  async function run(fact: MemoryFact, request: () => Promise<unknown>, apply: (all: MemoryFact[], result: unknown) => MemoryFact[]): Promise<boolean> {
    setBusy(fact.id);
    setError(null);
    try {
      const result = preview ? undefined : await request();
      setFacts((all) => apply(all, result));
      if (!preview) router.refresh();
      return true;
    } catch (e) {
      setError({ id: fact.id, text: message(e) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  const confirm = (fact: MemoryFact) =>
    run(
      fact,
      () => confirmFact(fact.id),
      (all) => {
        // In a single-valued slot the confirmed value replaces the one it challenged.
        const holder = holderOf(fact, all);
        const rest = holder ? all.filter((f) => f.id !== holder.id) : all;
        return rest.map((f) => (f.id === fact.id ? { ...f, trust: "trusted" as const, pending: false, challenges: null } : f));
      },
    );

  const forget = async () => {
    if (!forgetting) return;
    const fact = forgetting;
    if (await run(fact, () => forgetFact(fact.id), (all) => all.filter((f) => f.id !== fact.id))) setForgetting(null);
  };

  const correct = async () => {
    if (!correcting) return;
    const fact = correcting;
    const value = draft.trim();
    const done = await run(
      fact,
      () => correctFact(fact.id, value),
      (all, result) => {
        const saved = (result as { fact?: MemoryFact | null } | undefined)?.fact;
        const next: MemoryFact = saved ?? { ...fact, id: `${fact.id}-corrected`, value, trust: "trusted", source_kind: "person", source_ref: "memory-page", source_excerpt: null, valid_from: new Date().toISOString() };
        return all.map((f) => (f.id === fact.id ? next : f));
      },
    );
    if (done) {
      setCorrecting(null);
      setOpen(null);
    }
  };

  return (
    <>
      <PageHeader icon={<Brain />} title="Memory" />
      <Column
        title="Memory"
        description="What Marketer knows about your business, where it learned it, and what worked."
        control={
          <Segmented
            label="Memory views"
            // Five views don't fit a phone: the control scrolls sideways instead of clipping.
            className="max-w-full overflow-x-auto"
            value={tab}
            onChange={setTab}
            options={[
              { value: "facts", label: "Facts" },
              { value: "review", label: <>Needs you <CountBadge count={pending.length} /></> },
              { value: "learnings", label: "Learnings" },
              ...(recall ? [{ value: "personal" as const, label: "Personal" }, ...(canReadTeam ? [{ value: "team" as const, label: "Team" }] : [])] : []),
            ]}
          />
        }
      >
        {loadFailed && <Callout tone="attention">Couldn't load memory right now. Nothing was changed.</Callout>}

        {tab === "facts" &&
          (groups.length === 0 ? (
            <EmptyLine>Nothing remembered yet. Facts appear here as you tell Marketer about your brand, audience and offers.</EmptyLine>
          ) : (
            groups.map((group) => (
              <Section key={group.type} title={group.title}>
                <div className="space-y-3">
                  {group.subjects.map((subject) => (
                    <div key={subject.key} className="overflow-hidden rounded-ds-lg border border-hairline bg-surface">
                      <div className="border-b border-hairline px-3.5 py-2 text-[13px] font-medium text-fg">{subject.name}</div>
                      <ul className="divide-y divide-hairline">
                        {subject.facts.map((fact) => (
                          <FactRow
                            key={fact.id}
                            fact={fact}
                            open={open === fact.id}
                            onToggle={() => toggle(fact)}
                            history={history[fact.id]}
                            busy={busy === fact.id}
                            error={error?.id === fact.id ? error.text : null}
                            onConfirm={() => confirm(fact)}
                            onCorrect={() => {
                              setDraft(fact.value ?? "");
                              setError(null);
                              setCorrecting(fact);
                            }}
                            onForget={() => {
                              setError(null);
                              setForgetting(fact);
                            }}
                          />
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </Section>
            ))
          ))}

        {tab === "review" &&
          (pending.length === 0 ? (
            <EmptyLine>Nothing to review. Rules and values Marketer isn't sure about wait here for you.</EmptyLine>
          ) : (
            <div className="space-y-3">
              {pending.map((fact) => {
                const holder = holderOf(fact, current);
                const ref = sourceRef(fact);
                return (
                  <div key={fact.id}>
                    <PlanCard
                      icon={<FileQuestion className="size-4" />}
                      title={holder ? `A different ${predicateLabel(fact.predicate).toLowerCase()} for ${fact.subject_name}` : `New ${fact.subject_type}: ${fact.subject_name}`}
                      meta={fact.trust === "untrusted" ? "Outside source" : "From chat"}
                      steps={[
                        { label: <>{predicateLabel(fact.predicate)}: <span className="text-fg">{factText(fact)}</span></> },
                        ...(holder ? [{ label: <>Now: {factText(holder)}</>, state: "done" as const }] : []),
                        { label: <>{sourceLabel(fact.source_kind)}{ref ? ` (${ref})` : ""}, {formatDate(fact.source_at)}</> },
                      ]}
                      approveLabel={holder ? "Use the new value" : "Confirm"}
                      blocked={canConfirm ? undefined : "Your role can read memory but not confirm it."}
                      onApprove={() => confirm(fact)}
                      onDismiss={() => run(fact, () => forgetFact(fact.id), (all) => all.filter((f) => f.id !== fact.id))}
                      approving={busy === fact.id}
                    />
                    {error?.id === fact.id && <div className="mt-1.5"><Notice error={error.text} /></div>}
                  </div>
                );
              })}
            </div>
          ))}

        {tab === "learnings" && <Learnings learnings={learnings} />}

        {recall && tab === "personal" && <RecallView scope="personal" settings={recall.settings} page={recall.personal} preview={Boolean(preview)} />}
        {recall && tab === "team" && canReadTeam && <RecallView scope="team" settings={recall.settings} page={recall.team} preview={Boolean(preview)} />}

        <AskPill label="Ask what Marketer knows" href={ASK} />
      </Column>

      <ConfirmModal open={forgetting !== null} onClose={() => setForgetting(null)} title="Forget this?" confirmLabel="Forget" danger busy={busy !== null && busy === forgetting?.id} onConfirm={forget} error={forgetting && error?.id === forgetting.id ? error.text : null}>
        {forgetting && (
          <>
            Marketer stops using <span className="text-fg">{predicateLabel(forgetting.predicate).toLowerCase()}: {factText(forgetting)}</span> and the text is removed. A record that something was forgotten stays in the audit log.
          </>
        )}
      </ConfirmModal>

      <Modal
        open={correcting !== null}
        onClose={() => busy === null && setCorrecting(null)}
        title={correcting ? `Correct ${predicateLabel(correcting.predicate).toLowerCase()}` : "Correct"}
        width="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCorrecting(null)} disabled={busy !== null}>
              Cancel
            </Button>
            <Button variant="primary" onClick={correct} loading={busy !== null && busy === correcting?.id} disabled={!draft.trim() || draft.trim() === (correcting?.value ?? "")}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <Textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} aria-label="Corrected value" />
          <p className="text-[12px] text-fg-muted">The old value stays in this fact's history.</p>
          {correcting && error?.id === correcting.id && <Notice error={error.text} />}
        </div>
      </Modal>
    </>
  );
}

/** The current value a pending fact disagrees with: same subject and predicate (its id may have changed since). */
function holderOf(fact: MemoryFact, all: MemoryFact[]): MemoryFact | undefined {
  if (!fact.challenges) return undefined;
  return all.find((f) => f.id !== fact.id && !f.pending && !f.invalid_at && f.subject_type === fact.subject_type && f.subject_key === fact.subject_key && f.predicate === fact.predicate);
}

function bySubject(facts: MemoryFact[]): { key: string; name: string; facts: MemoryFact[] }[] {
  const map = new Map<string, { key: string; name: string; facts: MemoryFact[] }>();
  for (const f of facts) {
    const entry = map.get(f.subject_key) ?? { key: f.subject_key, name: f.subject_name, facts: [] };
    entry.facts.push(f);
    map.set(f.subject_key, entry);
  }
  return [...map.values()].map((s) => ({ ...s, facts: s.facts.sort((a, b) => a.predicate.localeCompare(b.predicate) || a.valid_from.localeCompare(b.valid_from)) }));
}

function TrustBadge({ fact }: { fact: MemoryFact }) {
  if (fact.trust === "trusted") return null;
  return <StatusBadge>{fact.trust === "untrusted" ? "Outside source" : "Unconfirmed"}</StatusBadge>;
}

const REASON: Record<string, string> = { superseded: "Replaced", corrected: "Corrected by you", merged: "Merged with a duplicate", forgotten: "Forgotten", dismissed: "Dismissed" };

function FactRow({
  fact,
  open,
  onToggle,
  history,
  busy,
  error,
  onConfirm,
  onCorrect,
  onForget,
}: {
  fact: MemoryFact;
  open: boolean;
  onToggle: () => void;
  history: MemoryFact[] | "loading" | "failed" | undefined;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCorrect: () => void;
  onForget: () => void;
}) {
  const panel = `fact-${fact.id}`;
  const earlier = Array.isArray(history) ? history.filter((h) => h.id !== fact.id && h.invalid_at).reverse() : [];
  const ref = sourceRef(fact);
  return (
    <li>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={panel} className="flex w-full items-start gap-3 px-3.5 py-2.5 text-left -outline-offset-2 hover:bg-surface-2">
        <span className="min-w-0 flex-1 sm:flex sm:gap-4">
          <span className="block shrink-0 text-[12px] text-fg-muted sm:w-28 sm:pt-px sm:text-[13px]">{predicateLabel(fact.predicate)}</span>
          <span className="block min-w-0 flex-1 break-words text-[13px] text-fg">{factText(fact)}</span>
        </span>
        <TrustBadge fact={fact} />
        <ChevronDown aria-hidden className={`mt-0.5 size-3.5 shrink-0 text-fg-faint ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id={panel} className="space-y-3 border-t border-hairline bg-surface-2 px-3.5 py-3 text-[12.5px]">
          <div>
            <div className="text-fg-faint">Where this came from</div>
            <div className="mt-1 text-fg-muted">
              {sourceLabel(fact.source_kind)}
              {ref ? ` (${ref})` : ""}, {formatDate(fact.source_at)}
              {fact.trust === "trusted" && fact.source_kind !== "person" ? ", confirmed by you" : ""}
            </div>
            {fact.source_excerpt && <blockquote className="mt-1.5 border-l-2 border-hairline-strong pl-2.5 text-fg-muted">{fact.source_excerpt}</blockquote>}
          </div>
          <div>
            <div className="text-fg-faint">Earlier values</div>
            {history === "loading" && <div className="mt-1 text-fg-muted">Loading…</div>}
            {history === "failed" && <div className="mt-1 text-fg-muted">Couldn't load the history.</div>}
            {Array.isArray(history) && earlier.length === 0 && <div className="mt-1 text-fg-muted">None. This is the first value.</div>}
            {earlier.length > 0 && (
              <ul className="mt-1 space-y-1">
                {earlier.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className={h.value === null && h.kind === "attribute" ? "text-fg-faint" : "min-w-0 break-words text-fg-muted line-through"}>{h.invalid_reason === "forgotten" || h.invalid_reason === "dismissed" ? "Forgotten" : factText(h)}</span>
                    <span className="shrink-0 text-fg-faint tabular">
                      {formatDate(h.valid_from)} to {formatDate(h.invalid_at)} · {REASON[h.invalid_reason ?? ""] ?? "Replaced"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {fact.trust !== "trusted" && (
              <Button size="sm" variant="secondary" onClick={onConfirm} loading={busy}>
                Confirm
              </Button>
            )}
            {fact.kind === "attribute" && (
              <Button size="sm" variant="secondary" onClick={onCorrect} disabled={busy}>
                Correct
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onForget} disabled={busy}>
              Forget
            </Button>
            <Notice inline error={error} />
          </div>
        </div>
      )}
    </li>
  );
}
