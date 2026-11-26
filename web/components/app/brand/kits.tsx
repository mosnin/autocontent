"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ConfirmModal, EmptyLine, Field, Input, List, ListRow, Modal, Notice, Segmented, StatusBadge, Textarea } from "@/design-system";
import { proxyFetch } from "@/lib/proxy-fetch";
import type { Kit, KitKind } from "@/lib/types";

const KIND: Record<KitKind, { tab: string; noun: string; blurb: string; placeholder: string }> = {
  design: {
    tab: "Design",
    noun: "design kit",
    blurb: "Shot grammar, transitions and framing for video. Used by the scriptwriter and visual director.",
    placeholder: "Open on the subject in motion, never a static establishing shot.\nCut on action. One signature slow push-in per video.",
  },
  writing: {
    tab: "Writing",
    noun: "writing kit",
    blurb: "Rhythm, vocabulary and structures on the page. Used by the article writers and QA.",
    placeholder: "Short declarative sentences. One-sentence paragraphs for emphasis.\nNever use ‘delve’, ‘unlock’ or ‘landscape’.",
  },
  ad: {
    tab: "Ads",
    noun: "ad kit",
    blurb: "The rules the Media buyer follows when it proposes changes. Spend caps and approvals still apply.",
    placeholder: "Scale winners while ROAS holds above target.\nNever scale a campaign twice in 48h.",
  },
};

type Editing = { mode: "new"; kind: KitKind } | { mode: "edit"; kit: Kit } | null;

/** Kits: reusable skills the agents carry (design, writing, ads). */
export function Kits({ kits }: { kits: Kit[] | null }) {
  const router = useRouter();
  const [kind, setKind] = useState<KitKind>("design");
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Kit | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      setDeleting(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const list = (kits ?? []).filter((k) => k.kind === kind);
  const meta = KIND[kind];

  return (
    <section id="kits" className="scroll-mt-4">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented label="Kit kind" value={kind} onChange={setKind} options={(Object.keys(KIND) as KitKind[]).map((k) => ({ value: k, label: KIND[k].tab }))} />
          <Button size="sm" onClick={() => setEditing({ mode: "new", kind })}>
            <Plus /> New {meta.noun}
          </Button>
        </div>
        <p className="text-[13px] text-fg-muted">{meta.blurb}</p>
        <Notice error={error} />
        {kits === null ? (
          <EmptyLine>Couldn't load your kits.</EmptyLine>
        ) : list.length === 0 ? (
          <EmptyLine>No {meta.noun}s yet. Make one and set it as the default.</EmptyLine>
        ) : (
          <List>
            {list.map((k) => (
              <ListRow key={k.id} className="flex-wrap">
                <button type="button" onClick={() => setEditing({ mode: "edit", kit: k })} className="min-w-0 flex-1 basis-[200px] text-left">
                  <span className="flex min-w-0 items-center gap-2 text-[13px]">
                    <span className="truncate font-medium hover:underline">{k.name}</span>
                    {k.is_default && <StatusBadge tone="accent">Default</StatusBadge>}
                  </span>
                  <span className="block truncate text-[12px] text-fg-muted">{k.description || k.content.split("\n")[0] || "Empty"}</span>
                </button>
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  {!k.is_default && (
                    <Button size="sm" variant="ghost" loading={busy === `def-${k.id}`} disabled={busy !== null} onClick={() => void run(`def-${k.id}`, () => proxyFetch(`/api/v1/kits/${k.id}`, "PUT", { is_default: true }))}>
                      Make default
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setDeleting(k)}>
                    Delete
                  </Button>
                </span>
              </ListRow>
            ))}
          </List>
        )}
      </div>

      <KitModal editing={editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), router.refresh())} />
      <ConfirmModal open={deleting !== null} onClose={() => setDeleting(null)} title={`Delete ${deleting?.name ?? "kit"}?`} confirmLabel="Delete" danger busy={busy === "delete"} onConfirm={() => deleting && void run("delete", () => proxyFetch(`/api/v1/kits/${deleting.id}`, "DELETE"))}>
        <p>Playbooks using it fall back to your default {deleting ? KIND[deleting.kind].noun : "kit"}. This can't be undone.</p>
      </ConfirmModal>
    </section>
  );
}

function KitModal({ editing, onClose, onSaved }: { editing: Editing; onClose: () => void; onSaved: () => void }) {
  const kit = editing?.mode === "edit" ? editing.kit : null;
  const kind: KitKind = editing?.mode === "edit" ? editing.kit.kind : (editing?.kind ?? "design");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={editing !== null}
      onClose={onClose}
      title={kit ? `Edit ${kit.name}` : `New ${KIND[kind].noun}`}
      width="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="kit-form" variant="primary" loading={busy}>
            {kit ? "Save kit" : "Create kit"}
          </Button>
        </>
      }
    >
      {editing && <KitForm key={kit?.id ?? `new-${kind}`} kit={kit} kind={kind} onBusy={setBusy} onSaved={onSaved} />}
    </Modal>
  );
}

function KitForm({ kit, kind, onBusy, onSaved }: { kit: Kit | null; kind: KitKind; onBusy: (b: boolean) => void; onSaved: () => void }) {
  const [name, setName] = useState(kit?.name ?? "");
  const [description, setDescription] = useState(kit?.description ?? "");
  const [content, setContent] = useState(kit?.content ?? "");
  const [rules, setRules] = useState(kit && Object.keys(kit.rules).length > 0 ? JSON.stringify(kit.rules, null, 2) : "");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) {
      setError("Give the kit a name.");
      return;
    }
    let parsedRules: Record<string, unknown> = {};
    if (kind === "ad" && rules.trim()) {
      try {
        parsedRules = JSON.parse(rules) as Record<string, unknown>;
      } catch {
        setError("Rules must be valid JSON.");
        return;
      }
    }
    onBusy(true);
    setError(null);
    try {
      if (kit) await proxyFetch(`/api/v1/kits/${kit.id}`, "PUT", { name: name.trim(), description, content, rules: parsedRules });
      else await proxyFetch("/api/v1/kits", "POST", { kind, name: name.trim(), description, content, rules: parsedRules, is_default: false });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      onBusy(false);
    }
  };

  return (
    <form
      id="kit-form"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My signature style" />
        </Field>
        <Field label="Description" hint="Optional.">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="When to use it" />
        </Field>
      </div>
      <Field label="The skill">
        <Textarea rows={6} value={content} onChange={(e) => setContent(e.target.value)} placeholder={KIND[kind].placeholder} />
      </Field>
      {kind === "ad" && (
        <Field label="Rules (JSON)" hint="target_roas, scale_up_pct, scale_down_pct, max_daily_budget_usd">
          <Textarea rows={4} value={rules} onChange={(e) => setRules(e.target.value)} className="font-mono text-[12.5px]" placeholder='{"target_roas": 2.5, "scale_up_pct": 15, "max_daily_budget_usd": 200}' />
        </Field>
      )}
      <Notice error={error} />
    </form>
  );
}
