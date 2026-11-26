"use client";

import { Plus } from "lucide-react";
import * as React from "react";
import useSWR from "swr";
import { AdminFrame } from "@/components/app/admin/admin-frame";
import { formatDateTime, relativeTime } from "@/components/app/admin/format";
import { Button, EmptyLine, Field, Input, ListRow, List, Modal, Notice, StatusBadge, Switch, Table, Textarea } from "@/design-system";
import { adminKeys, adminUpsertFlag } from "@/lib/admin-api";
import type { FeatureFlag } from "@/lib/admin-types";
import { clientFetch } from "@/lib/client-fetcher";

const POLL_MS = 30_000;

export function FlagsClient({ initial }: { initial: FeatureFlag[] }) {
  const { data, error, mutate } = useSWR<FeatureFlag[]>(adminKeys.flags(), clientFetch, { refreshInterval: POLL_MS, fallbackData: initial });
  const [addOpen, setAddOpen] = React.useState(false);
  // Keys currently mid-flight, so we can disable just that row's switch.
  const [pending, setPending] = React.useState<Set<string>>(new Set());
  const [note, setNote] = React.useState<{ ok?: string; error?: string } | null>(null);

  const flags = data ?? [];
  const sorted = React.useMemo(() => [...flags].sort((a, b) => a.key.localeCompare(b.key)), [flags]);

  const setPendingFor = (k: string, on: boolean) =>
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(k);
      else next.delete(k);
      return next;
    });

  const onToggle = async (flag: FeatureFlag, nextEnabled: boolean) => {
    setPendingFor(flag.key, true);
    setNote(null);
    const optimistic = (list: FeatureFlag[] | undefined) => (list ?? []).map((f) => (f.key === flag.key ? { ...f, enabled: nextEnabled } : f));
    try {
      await mutate(
        async () => {
          const updated = await adminUpsertFlag(flag.key, { enabled: nextEnabled, description: flag.description });
          return (data ?? []).map((f) => (f.key === flag.key ? updated : f));
        },
        { optimisticData: optimistic, rollbackOnError: true, revalidate: false, populateCache: true },
      );
      setNote({ ok: `${flag.key} ${nextEnabled ? "enabled" : "disabled"}. Change audited.` });
    } catch (err) {
      setNote({ error: err instanceof Error ? err.message : "Update failed" });
    } finally {
      setPendingFor(flag.key, false);
    }
  };

  return (
    <AdminFrame
      crumbs={[{ label: "Flags" }]}
      actions={
        <Button size="sm" variant="primary" onClick={() => setAddOpen(true)}>
          <Plus /> Add flag
        </Button>
      }
    >
      {error && <Notice error={`Live updates paused: ${error.message ?? "fetch failed"}`} />}
      {note && <Notice ok={note.ok} error={note.error} />}
      <Table<FeatureFlag>
        rows={sorted}
        rowKey={(f) => f.key}
        empty={<EmptyLine action={<Button size="sm" onClick={() => setAddOpen(true)}>Add flag</Button>}>No feature flags yet.</EmptyLine>}
        columns={[
          {
            key: "key",
            label: "Flag",
            render: (f) => (
              <span className="flex items-center gap-2">
                <code className="font-mono text-[12.5px] font-medium">{f.key}</code>
                <StatusBadge tone={f.enabled ? "positive" : "neutral"}>{f.enabled ? "On" : "Off"}</StatusBadge>
              </span>
            ),
          },
          { key: "desc", label: "Description", hideOnPhone: true, render: (f) => <span className="block max-w-[420px] truncate text-fg-muted">{f.description || "No description"}</span> },
          {
            key: "updated",
            label: "Updated",
            hideOnPhone: true,
            render: (f) => (
              <span className="text-fg-muted" title={formatDateTime(f.updated_at)}>
                {relativeTime(f.updated_at)}
                {f.updated_by ? ` · ${f.updated_by}` : ""}
              </span>
            ),
          },
          { key: "enabled", label: "Enabled", align: "right", width: "84px", render: (f) => <Switch checked={f.enabled} disabled={pending.has(f.key)} onChange={(v) => void onToggle(f, v)} label={`${f.enabled ? "Disable" : "Enable"} ${f.key}`} /> },
        ]}
      />
      <AddFlagModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        existingKeys={flags.map((f) => f.key)}
        onCreated={(created) => {
          setAddOpen(false);
          setNote({ ok: `Flag ${created.key} created. Change audited.` });
          void mutate((list) => [...(list ?? []).filter((f) => f.key !== created.key), created], { revalidate: false });
        }}
      />
    </AdminFrame>
  );
}

function AddFlagModal({ open, onClose, existingKeys, onCreated }: { open: boolean; onClose: () => void; existingKeys: string[]; onCreated: (flag: FeatureFlag) => void }) {
  const [key, setKey] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [enabled, setEnabled] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) (setKey(""), setDescription(""), setEnabled(false), setError(null));
  }, [open]);

  const trimmed = key.trim();
  const duplicate = existingKeys.includes(trimmed);
  const validKey = /^[a-z0-9][a-z0-9._-]*$/.test(trimmed);
  const canSubmit = trimmed !== "" && validKey && !duplicate && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed) return setError("A flag key is required.");
    if (!validKey) return setError("Use lowercase letters, numbers, dots, dashes or underscores.");
    if (duplicate) return setError("A flag with that key already exists.");
    setBusy(true);
    setError(null);
    try {
      onCreated(await adminUpsertFlag(trimmed, { enabled, description: description.trim() }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title="Add a flag"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="flag-form" variant="primary" loading={busy} disabled={!canSubmit}>
            Create flag
          </Button>
        </>
      }
    >
      <form id="flag-form" onSubmit={submit} className="space-y-4">
        <p className="text-[13px] text-fg-muted">Takes effect as soon as you save. Every change is audited.</p>
        <Field label="Key" hint={trimmed !== "" && !validKey ? "Lowercase letters, numbers, dots, dashes or underscores only." : duplicate ? "A flag with this key already exists." : undefined}>
          <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="new_editor" className="font-mono" autoFocus aria-invalid={trimmed !== "" && (!validKey || duplicate) ? true : undefined} />
        </Field>
        <Field label="Description">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this flag gate?" maxLength={500} rows={3} />
        </Field>
        <List>
          <ListRow>
            <span className="min-w-0 flex-1 text-[13px]">Start enabled</span>
            <Switch checked={enabled} onChange={setEnabled} label="Initial enabled state" />
          </ListRow>
        </List>
        <Notice error={error} />
      </form>
    </Modal>
  );
}
