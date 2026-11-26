"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Callout, ConfirmModal, EmptyLine, Input, Notice, Section, SwitchRow, useAllowed } from "@/design-system";
import { formatDate } from "@/lib/format";
import { forgetRecall, previewForget, saveRecallSettings } from "./client";
import type { RecallItem, RecallPage, RecallScope, RecallSettings } from "./types";

const message = (e: unknown): string => (e instanceof Error && e.message ? e.message : "Something went wrong");

const COPY: Record<RecallScope, { title: string; empty: string; explain: string }> = {
  personal: {
    title: "What you told Marketer",
    empty: "Nothing yet. What you say in your conversations with Marketer shows up here once its memory has formed.",
    explain: "Only you can see these. Not owners, not admins. Marketer uses them only when it works for you.",
  },
  team: {
    title: "What the workspace knows",
    empty: "Nothing yet. Confirmed facts, the brand kit, playbooks and published articles are copied here.",
    explain: "Copied from confirmed facts, the brand kit, playbooks and published articles. Conversations never land here.",
  },
};

/**
 * Recall (Supermemory): the person's own memories (Personal) or the workspace's (Team), with a preview-then-forget
 * flow, and the workspace switch for people allowed to manage security.
 */
export function RecallView({ scope, settings, page, preview }: { scope: RecallScope; settings: RecallSettings | null; page: RecallPage | null; preview?: boolean }) {
  const router = useRouter();
  const canManage = useAllowed("security:manage");
  const canForgetTeam = useAllowed("memory:forget");
  const canForget = scope === "personal" || canForgetTeam;
  const [items, setItems] = useState<RecallItem[]>(page?.items ?? []);
  const [enabled, setEnabled] = useState(Boolean(settings?.enabled));
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<RecallItem[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<string[] | null>(null);
  const [turningOff, setTurningOff] = useState(false);
  const [deleteData, setDeleteData] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(0);
  const copy = COPY[scope];

  async function find() {
    const q = query.trim();
    if (q.length < 2) return;
    setBusy("preview");
    setError(null);
    try {
      const found = preview ? items.filter((i) => i.memory.toLowerCase().includes(q.toLowerCase())) : await previewForget(scope, q);
      setMatches(found);
      setPicked(new Set(found.map((m) => m.id)));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  async function forget() {
    if (!confirming) return;
    const ids = confirming;
    setBusy("forget");
    setError(null);
    try {
      if (!preview) await forgetRecall(scope, ids);
      setItems((all) => all.filter((i) => !ids.includes(i.id)));
      setRemoved((n) => n + ids.length);
      setMatches((m) => (m ? m.filter((i) => !ids.includes(i.id)) : m));
      setConfirming(null);
      if (!preview) router.refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  async function save(next: boolean, wipe = false) {
    setBusy("settings");
    setError(null);
    try {
      if (!preview) await saveRecallSettings(next, wipe);
      setEnabled(next);
      setTurningOff(false);
      setDeleteData(false);
      if (!next) setItems([]);
      if (!preview) router.refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  if (settings === null) return <Callout tone="attention">Couldn&apos;t load recall right now. Nothing was changed.</Callout>;

  return (
    <div className="space-y-6">
      {canManage && (
        <SwitchRow
          label="Recall across conversations"
          detail={settings.configured ? "Marketer remembers what each person tells it (privately, per person) and searches the workspace's confirmed knowledge. Text is sent to Supermemory, a subprocessor." : "Not set up on this deployment yet: an API key and a namespace secret are needed."}
          checked={enabled}
          disabled={!settings.configured || busy === "settings"}
          onChange={(next) => (next ? void save(true) : setTurningOff(true))}
        />
      )}

      {!settings.configured || !enabled ? (
        <EmptyLine>{!settings.configured ? "Recall isn't set up on this deployment." : canManage ? "Recall is off. Turn it on above." : "Recall is off for this workspace. Someone who manages security can turn it on."}</EmptyLine>
      ) : (
        <>
          {error && <Notice error={error} />}
          {canForget && (
            <Section title="Forget by meaning">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void find();
                }}
              >
                <Input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={500} placeholder={scope === "personal" ? "e.g. my old address" : "e.g. last year's pricing"} aria-label="What should be forgotten" className="min-w-0 flex-1" />
                <Button type="submit" variant="secondary" loading={busy === "preview"} disabled={query.trim().length < 2}>
                  {busy !== "preview" && <Search />}
                  Find
                </Button>
              </form>
              {matches !== null && (
                <div className="mt-3 space-y-2">
                  {matches.length === 0 ? (
                    <p className="text-[12.5px] text-fg-muted">Nothing matches. Nothing was changed.</p>
                  ) : (
                    <>
                      <p className="text-[12.5px] text-fg-muted">These match. Nothing is forgotten until you confirm.</p>
                      <ul className="divide-y divide-hairline overflow-hidden rounded-ds-lg border border-hairline bg-surface">
                        {matches.map((m) => (
                          <li key={m.id}>
                            <label className="flex cursor-pointer items-start gap-3 px-3.5 py-2.5 text-[13px] hover:bg-surface-2">
                              <input
                                type="checkbox"
                                className="mt-0.5 accent-[var(--ds-accent)]"
                                checked={picked.has(m.id)}
                                onChange={(e) =>
                                  setPicked((s) => {
                                    const next = new Set(s);
                                    if (e.target.checked) next.add(m.id);
                                    else next.delete(m.id);
                                    return next;
                                  })
                                }
                              />
                              <span className="min-w-0 flex-1 break-words text-fg">{m.memory}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                      <Button variant="secondary" disabled={picked.size === 0} onClick={() => setConfirming([...picked])}>
                        Forget {picked.size} selected
                      </Button>
                    </>
                  )}
                </div>
              )}
            </Section>
          )}

          <Section title={copy.title}>
            <p className="-mt-1.5 mb-3 text-[12.5px] text-fg-muted">{copy.explain}</p>
            {items.length === 0 ? (
              <EmptyLine>{copy.empty}</EmptyLine>
            ) : (
              <ul className="divide-y divide-hairline overflow-hidden rounded-ds-lg border border-hairline bg-surface">
                {items.map((m) => (
                  <li key={m.id} className="flex items-start gap-3 px-3.5 py-2.5">
                    <span className="min-w-0 flex-1 sm:flex sm:gap-4">
                      <span className="block min-w-0 flex-1 break-words text-[13px] text-fg">{m.memory}</span>
                      {m.updated_at && <span className="block shrink-0 text-[12px] text-fg-faint tabular sm:pt-px">{formatDate(m.updated_at)}</span>}
                    </span>
                    {canForget && (
                      <Button size="sm" variant="ghost" onClick={() => setConfirming([m.id])} disabled={busy !== null}>
                        Forget
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {page && page.total - removed > items.length && items.length > 0 && <p className="mt-2 text-[12px] text-fg-faint">Showing the {items.length} most recent of {page.total - removed}.</p>}
          </Section>
        </>
      )}

      <ConfirmModal open={confirming !== null} onClose={() => setConfirming(null)} title={confirming && confirming.length > 1 ? `Forget ${confirming.length} memories?` : "Forget this memory?"} confirmLabel="Forget" danger busy={busy === "forget"} onConfirm={forget} error={confirming ? error : null}>
        {scope === "personal" ? "Marketer stops recalling it in your conversations." : "Marketer stops recalling it for everyone in the workspace."} The audit log records that something was forgotten, never what.
      </ConfirmModal>

      <ConfirmModal open={turningOff} onClose={() => setTurningOff(false)} title="Turn off recall?" confirmLabel="Turn off" danger busy={busy === "settings"} onConfirm={() => save(false, deleteData)} error={turningOff ? error : null}>
        <div className="space-y-3">
          <p>Marketer stops reading and writing recall for everyone in this workspace. Facts and learnings are not affected.</p>
          <SwitchRow label="Also delete everything recall holds" detail="Every person's private memories and the workspace's. This can't be undone." checked={deleteData} onChange={setDeleteData} />
        </div>
      </ConfirmModal>
    </div>
  );
}
