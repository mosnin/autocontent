"use client";

import { Clapperboard, Megaphone, PenLine, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import type { Kit, KitKind } from "@/lib/types";
import { Badge, Button, ErrorText, Field, IconTile, Input, Modal, Segmented, Textarea } from "../ui";
import { ConfirmModal, proxyFetch } from "../settings/primitives";

const KIND: Record<KitKind, { tab: string; noun: string; icon: ReactNode; blurb: string; placeholder: string }> = {
  design: {
    tab: "Design",
    noun: "design kit",
    icon: <Clapperboard />,
    blurb: "Your direction for video: shot grammar, transitions, framing habits, signature touches. The scriptwriter and visual director use it on every render.",
    placeholder: "Open on the subject in motion, never a static establishing shot.\nCut on action. One signature slow push-in per video.",
  },
  writing: {
    tab: "Writing",
    noun: "writing kit",
    icon: <PenLine />,
    blurb: "Your voice on the page: rhythm, vocabulary, structures, banned clichés. The article writers and QA use it.",
    placeholder: "Short declarative sentences. One-sentence paragraphs for emphasis.\nNever use ‘delve’, ‘unlock’ or ‘landscape’.",
  },
  ad: {
    tab: "Ads",
    noun: "ad kit",
    icon: <Megaphone />,
    blurb: "Your scaling strategy: the rules the Media buyer follows when it proposes changes. The spend guard and approvals still rule every execution.",
    placeholder: "Scale winners while ROAS holds above target.\nNever scale a campaign twice in 48h.",
  },
};

type Editing = { mode: "new"; kind: KitKind } | { mode: "edit"; kit: Kit } | null;

/** Kits: reusable skills that ride along with the agents (design, writing, ads). */
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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Kit kind" value={kind} onChange={setKind} className="w-full sm:w-[260px]" options={(Object.keys(KIND) as KitKind[]).map((k) => ({ value: k, label: KIND[k].tab }))} />
        <Button size="sm" onClick={() => setEditing({ mode: "new", kind })}>
          <Plus /> New {meta.noun}
        </Button>
      </div>
      <p className="max-w-[62ch] text-[13px] text-muted-foreground">{meta.blurb}</p>
      <ErrorText error={error} />
      {kits === null ? (
        <p className="rounded-[14px] bg-subtle px-4 py-5 text-[13px] text-muted-foreground">We couldn't load your kits right now.</p>
      ) : list.length === 0 ? (
        <p className="rounded-[14px] bg-subtle px-4 py-5 text-[13px] text-muted-foreground">No {meta.noun}s yet. Make one and set it as the default to use it everywhere.</p>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-card">
          {list.map((k) => (
            <div key={k.id} className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
              <IconTile>{meta.icon}</IconTile>
              <button type="button" onClick={() => setEditing({ mode: "edit", kit: k })} className="min-w-0 flex-1 basis-[180px] text-left">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[14px] font-medium hover:underline">{k.name}</span>
                  {k.is_default && <Badge tone="accent">Default</Badge>}
                </span>
                <span className="block truncate text-[13px] text-muted-foreground">{k.description || k.content.split("\n")[0] || "Empty"}</span>
              </button>
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {!k.is_default && (
                  <Button size="sm" variant="ghost" loading={busy === `def-${k.id}`} disabled={busy !== null} onClick={() => void run(`def-${k.id}`, () => proxyFetch(`/api/v1/kits/${k.id}`, "PUT", { is_default: true }))}>
                    Make default
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="hover:text-destructive" disabled={busy !== null} onClick={() => setDeleting(k)}>
                  Delete
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}

      <KitModal editing={editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), router.refresh())} />
      <ConfirmModal open={deleting !== null} onClose={() => setDeleting(null)} title={`Delete ${deleting?.name ?? "kit"}?`} confirmLabel="Delete" danger busy={busy === "delete"} onConfirm={() => deleting && void run("delete", () => proxyFetch(`/api/v1/kits/${deleting.id}`, "DELETE"))}>
        <p>Playbooks using it fall back to your default {deleting ? KIND[deleting.kind].noun : "kit"}. This can't be undone.</p>
      </ConfirmModal>
    </div>
  );
}

function KitModal({ editing, onClose, onSaved }: { editing: Editing; onClose: () => void; onSaved: () => void }) {
  const kit = editing?.mode === "edit" ? editing.kit : null;
  const kind: KitKind = editing?.mode === "edit" ? editing.kit.kind : (editing?.kind ?? "design");
  return (
    <Modal open={editing !== null} onClose={onClose} title={kit ? `Edit ${kit.name}` : `New ${KIND[kind].noun}`} wide>
      {editing && <KitForm key={kit?.id ?? `new-${kind}`} kit={kit} kind={kind} onCancel={onClose} onSaved={onSaved} />}
    </Modal>
  );
}

function KitForm({ kit, kind, onCancel, onSaved }: { kit: Kit | null; kind: KitKind; onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState(kit?.name ?? "");
  const [description, setDescription] = useState(kit?.description ?? "");
  const [content, setContent] = useState(kit?.content ?? "");
  const [rules, setRules] = useState(kit && Object.keys(kit.rules).length > 0 ? JSON.stringify(kit.rules, null, 2) : "");
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    setError(null);
    try {
      if (kit) await proxyFetch(`/api/v1/kits/${kit.id}`, "PUT", { name: name.trim(), description, content, rules: parsedRules });
      else await proxyFetch("/api/v1/kits", "POST", { kind, name: name.trim(), description, content, rules: parsedRules, is_default: false });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <form
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
        <Field label="Description (optional)">
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
      <ErrorText error={error} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          {kit ? "Save kit" : "Create kit"}
        </Button>
      </div>
    </form>
  );
}
