"use client";

import * as React from "react";
import { AdminFrame } from "@/components/app/admin/admin-frame";
import { actionTone, formatDateTime, humanizeAction, relativeTime } from "@/components/app/admin/format";
import { Button, CodeBlock, EmptyLine, Facts, Input, Modal, Notice, StatusBadge, Table } from "@/design-system";
import { adminKeys } from "@/lib/admin-api";
import type { AuditEntry, AuditQuery } from "@/lib/admin-types";
import { clientFetch } from "@/lib/client-fetcher";

export const AUDIT_PAGE_SIZE = 50;
// Page cap: past this many rows in the DOM, narrow with the filters instead of loading more.
const AUDIT_MAX_ROWS = 500;

type Filters = { action: string; target_type: string; target_id: string; actor_id: string };
const EMPTY: Filters = { action: "", target_type: "", target_id: "", actor_id: "" };

const toFilters = (q: AuditQuery): Filters => ({ action: q.action ?? "", target_type: q.target_type ?? "", target_id: q.target_id ?? "", actor_id: q.actor_id ?? "" });
const toQuery = (f: Filters): AuditQuery => ({
  action: f.action.trim() || undefined,
  target_type: f.target_type.trim() || undefined,
  target_id: f.target_id.trim() || undefined,
  actor_id: f.actor_id.trim() || undefined,
});

const FIELDS: { key: keyof Filters; label: string; placeholder: string }[] = [
  { key: "action", label: "Action", placeholder: "user.suspend" },
  { key: "target_type", label: "Target type", placeholder: "user" },
  { key: "target_id", label: "Target ID", placeholder: "Target ID" },
  { key: "actor_id", label: "Actor ID", placeholder: "Actor ID" },
];

export function AuditClient({ initial, initialFilters }: { initial: AuditEntry[]; initialFilters: AuditQuery }) {
  const [draft, setDraft] = React.useState<Filters>(toFilters(initialFilters));
  const [applied, setApplied] = React.useState<Filters>(toFilters(initialFilters));
  const [entries, setEntries] = React.useState<AuditEntry[]>(initial);
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(initial.length < AUDIT_PAGE_SIZE);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<AuditEntry | null>(null);
  const mounted = React.useRef(false);

  const load = React.useCallback(async (reset: boolean, filters: Filters, cursorId?: number) => {
    setLoading(true);
    setError(null);
    try {
      const page = await clientFetch<AuditEntry[]>(adminKeys.audit({ ...toQuery(filters), before_id: reset ? undefined : cursorId, limit: AUDIT_PAGE_SIZE }));
      setEntries((prev) => (reset ? page : [...prev, ...page]));
      setDone(page.length < AUDIT_PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload from scratch whenever the applied filters change (not on mount:
  // the server already provided that page).
  React.useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    void load(true, applied);
  }, [applied, load]);

  const filtered = Object.values(applied).some(Boolean);
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);

  return (
    <AdminFrame
      crumbs={[{ label: "Audit log" }]}
      toolbar={
        <form
          className="flex w-full flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(draft);
          }}
        >
          {FIELDS.map((f) => (
            <div key={f.key} className="w-[calc(50%-3px)] sm:w-36">
              <Input aria-label={f.label} placeholder={f.placeholder} value={draft[f.key]} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} className="h-7 font-mono text-[12px]" />
            </div>
          ))}
          <Button type="submit" size="md" variant={dirty ? "primary" : "secondary"}>
            Apply
          </Button>
          {(filtered || dirty) && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraft(EMPTY);
                setApplied(EMPTY);
              }}
            >
              Clear
            </Button>
          )}
        </form>
      }
    >
      <Notice error={error} />
      <Table<AuditEntry>
        rows={entries}
        // Paging is server-side here ("Load more" below), so the table shows every loaded row.
        pageSize={AUDIT_MAX_ROWS + AUDIT_PAGE_SIZE}
        rowKey={(e) => String(e.id)}
        empty={<EmptyLine>{loading ? "Loading…" : "No audit entries match these filters."}</EmptyLine>}
        columns={[
          { key: "action", label: "Action", render: (e) => <span className="whitespace-nowrap"><StatusBadge tone={actionTone(e.action)}>{humanizeAction(e.action)}</StatusBadge></span> },
          { key: "actor", label: "Actor", hideOnPhone: true, render: (e) => <span className="block max-w-[220px] truncate">{e.actor_email}</span> },
          {
            key: "target",
            label: "Target",
            hideOnPhone: true,
            render: (e) => (
              <span className="block max-w-[240px] truncate font-mono text-[12px] text-fg-muted">
                <span className="text-fg">{e.target_type}</span>
                {e.target_id ? ` · ${e.target_id}` : ""}
              </span>
            ),
          },
          { key: "ip", label: "IP", hideOnPhone: true, render: (e) => <span className="font-mono text-[12px] text-fg-muted">{e.ip ?? "—"}</span> },
          { key: "when", label: "When", align: "right", render: (e) => <span className="whitespace-nowrap text-fg-muted" title={formatDateTime(e.created_at)}>{relativeTime(e.created_at)}</span> },
          {
            key: "more",
            label: <span className="sr-only">Details</span>,
            align: "right",
            width: "72px",
            render: (e) => (
              <Button size="sm" variant="ghost" onClick={() => setOpen(e)} aria-label={`Details for ${humanizeAction(e.action)}`}>
                Details
              </Button>
            ),
          },
        ]}
      />
      {entries.length > 0 && (
        <div className="flex justify-center">
          {done ? (
            <p className="text-[12px] text-fg-muted">
              End of log · {entries.length} entr{entries.length === 1 ? "y" : "ies"}
            </p>
          ) : entries.length >= AUDIT_MAX_ROWS ? (
            <p className="text-[12px] text-fg-muted">Showing the latest {entries.length} entries. Narrow the filters to see older ones.</p>
          ) : (
            <Button variant="secondary" loading={loading} onClick={() => void load(false, applied, entries[entries.length - 1]?.id)}>
              Load more
            </Button>
          )}
        </div>
      )}
      <AuditDetail entry={open} onClose={() => setOpen(null)} />
    </AdminFrame>
  );
}

function AuditDetail({ entry, onClose }: { entry: AuditEntry | null; onClose: () => void }) {
  const meta = entry?.metadata && Object.keys(entry.metadata).length > 0 ? JSON.stringify(entry.metadata, null, 2) : null;
  return (
    <Modal open={entry !== null} onClose={onClose} title={entry ? humanizeAction(entry.action) : "Audit entry"}>
      {entry && (
        <div className="space-y-3">
          <Facts
            items={[
              { label: "Action", value: <code className="font-mono text-[12px]">{entry.action}</code> },
              { label: "Actor", value: entry.actor_email },
              { label: "Target", value: <code className="font-mono text-[12px]">{entry.target_type}{entry.target_id ? ` · ${entry.target_id}` : ""}</code> },
              { label: "IP", value: entry.ip ?? "—" },
              { label: "Time", value: formatDateTime(entry.created_at) },
              ...(entry.user_agent ? [{ label: "User agent", value: <span title={entry.user_agent}>{entry.user_agent}</span> }] : []),
            ]}
          />
          {meta && <CodeBlock code={meta} />}
        </div>
      )}
    </Modal>
  );
}
