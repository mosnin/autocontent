"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ConfirmModal, IconButton, Notice, Sheet, Switch, Time, cx } from "@/design-system";
import { type CellValue, type HistoryEntry, type TrackerField, type TrackerRow, cellText, rowTitle } from "@/lib/tracker";
import { trackerApi } from "@/lib/tracker-client";
import { CellDisplay, FIELD_ICON, OpenObject, PICKER_TYPES, Picker, TextEditor, fromPicked, isMulti, toPicked, usePickItems } from "./cells";
import { useTracker } from "./context";
import type { RowOps } from "./table-view";

function PickerField({ field, value, onChange, disabled }: { field: TrackerField; value: CellValue | undefined; onChange: (v: CellValue) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const { items, loading, onSearch } = usePickItems(field, open);
  const [picked, setPicked] = useState(toPicked(field, value));
  useEffect(() => setPicked(toPicked(field, value)), [field, value]);
  const empty = picked.length === 0;
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${field.name}: ${empty ? "empty" : "change"}`}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-8 w-full items-center rounded-ds-md border border-transparent px-2 py-1 text-left hover:border-hairline hover:bg-surface-2 disabled:pointer-events-none"
      >
        {empty ? <span className="text-fg-faint">{disabled ? "Empty" : "Pick…"}</span> : <CellDisplay field={field} value={value} wrap />}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1">
          <Picker
            label={`Pick ${field.name}`}
            items={items}
            selected={picked}
            multi={isMulti(field.type)}
            loading={loading}
            onSearch={onSearch}
            onPick={(next) => {
              setPicked(next);
              if (!isMulti(field.type)) onChange(fromPicked(field, next));
            }}
            onClose={() => {
              if (isMulti(field.type) && JSON.stringify(next(picked)) !== JSON.stringify(next(toPicked(field, value)))) onChange(fromPicked(field, picked));
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

const next = (ids: string[]) => [...ids].sort();

function FieldValue({ field, value, onChange, disabled }: { field: TrackerField; value: CellValue | undefined; onChange: (v: CellValue) => void; disabled: boolean }) {
  const [editing, setEditing] = useState(false);
  const { resolved } = useTracker();
  if (field.type === "checkbox") return <div className="flex h-8 items-center px-2"><Switch label={field.name} checked={!!value} disabled={disabled} onChange={(v) => onChange(v)} /></div>;
  if (PICKER_TYPES.includes(field.type)) {
    const obj = field.type === "marketer_link" && typeof value === "string" ? resolved.objects[`${field.options.kind}:${value}`] : undefined;
    return (
      <div>
        <PickerField field={field} value={value} onChange={onChange} disabled={disabled} />
        {obj && (
          <div className="mt-1 flex items-center gap-3 px-2 text-[12px] text-fg-muted">
            {Object.entries(obj.metrics).map(([k, v]) => (
              <span key={k} className="tabular">
                {k.replace(/_/g, " ").replace(" usd", "")}: {k.endsWith("usd") ? `$${Number(v).toLocaleString("en-US")}` : typeof v === "number" ? v.toLocaleString("en-US") : String(v).slice(0, 10)}
              </span>
            ))}
            <OpenObject obj={obj} />
          </div>
        )}
      </div>
    );
  }
  if (editing && !disabled)
    return <TextEditor field={field} value={value} onCommit={(v) => (setEditing(false), JSON.stringify(v) !== JSON.stringify(value ?? null) && onChange(v))} onCancel={() => setEditing(false)} />;
  const empty = value === null || value === undefined || value === "";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setEditing(true)}
      aria-label={`${field.name}: ${empty ? "empty" : "edit"}`}
      className={cx("flex min-h-8 w-full items-center rounded-ds-md border border-transparent px-2 py-1 text-left hover:border-hairline hover:bg-surface-2 disabled:pointer-events-none", field.type === "long_text" && "items-start")}
    >
      {empty ? <span className="text-fg-faint">{disabled ? "Empty" : "Add…"}</span> : <CellDisplay field={field} value={value} wrap />}
    </button>
  );
}

function describeChange(field: TrackerField | undefined, change: { before: CellValue; after: CellValue }, ctx: Parameters<typeof cellText>[2]): string {
  if (!field) return "a field that was removed";
  const show = (v: CellValue) => cellText(field, v, ctx) || "empty";
  if (change.before === null || change.before === undefined) return `${field.name} to ${show(change.after)}`;
  return `${field.name} from ${show(change.before)} to ${show(change.after)}`;
}

/** The whole row in a sheet: every field, editable in place, the linked Marketer items live, and the row's history. */
export function RowSheet({ row, onClose, ops, preview }: { row: TrackerRow | null; onClose: () => void; ops: RowOps; preview: boolean }) {
  const { table, canEdit, canDelete, members, resolved } = useTracker();
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const rowId = row?.id ?? null;
  const updatedAt = row?.updated_at;
  useEffect(() => {
    setHistory(null);
    setHistoryError(false);
    if (!rowId || preview) return;
    let live = true;
    trackerApi
      .history(table.id, rowId)
      .then((h) => live && setHistory(h))
      .catch(() => live && setHistoryError(true));
    return () => {
      live = false;
    };
  }, [rowId, updatedAt, table.id, preview]);
  const name = (id: string | null) => (id ? (members.find((m) => m.id === id)?.name ?? "Someone") : "Marketer");

  return (
    <>
      <Sheet
        open={row !== null}
        onClose={onClose}
        title={row ? rowTitle(table, row) : ""}
        description={row ? <>Updated <Time iso={row.updated_at} /></> : undefined}
        width="md"
        actions={
          row && canDelete ? (
            <IconButton label="Delete row" onClick={() => setConfirm(true)}>
              <Trash2 />
            </IconButton>
          ) : undefined
        }
      >
        {row && (
          <div className="space-y-6">
            <dl className="space-y-1">
              {table.fields.map((f) => (
                <div key={f.id} className="grid grid-cols-1 gap-1 sm:grid-cols-[140px_1fr] sm:gap-3">
                  <dt className="flex h-8 items-center gap-1.5 text-[12.5px] text-fg-muted [&_svg]:size-3.5 [&_svg]:text-fg-faint">
                    {FIELD_ICON[f.type]}
                    <span className="truncate">{f.name}</span>
                  </dt>
                  <dd className="min-w-0 text-[13px]">
                    <FieldValue field={f} value={row.values[f.id]} disabled={!canEdit} onChange={(v) => ops.updateCell(row.id, f.id, v)} />
                  </dd>
                </div>
              ))}
            </dl>
            <section aria-label="History">
              <h3 className="mb-2 text-[12.5px] font-medium text-fg-muted">History</h3>
              {preview && <p className="text-[12.5px] text-fg-muted">Every change is kept here with who made it.</p>}
              {historyError && <Notice error="Couldn't load the history." />}
              {!preview && !history && !historyError && <p className="text-[12.5px] text-fg-faint">Loading…</p>}
              {history && (
                <ol className="space-y-2">
                  {history.map((h) => (
                    <li key={h.id} className="text-[12.5px] leading-relaxed text-fg-muted">
                      <span className="text-fg">{name(h.actor_id)}</span>{" "}
                      {h.action === "created" ? "added this row" : h.action === "deleted" ? "deleted this row" : <>changed {Object.entries(h.changes).map(([fid, c]) => describeChange(table.fields.find((f) => f.id === fid), c, { members, resolved })).join("; ")}</>}
                      {" · "}
                      <Time iso={h.at} className="text-fg-faint" />
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
      </Sheet>
      <ConfirmModal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete this row?"
        confirmLabel="Delete row"
        danger
        onConfirm={() => {
          setConfirm(false);
          if (row) void ops.deleteRow(row.id);
        }}
      >
        “{row ? rowTitle(table, row) : ""}” is removed from every view. Its history stays in the audit trail.
      </ConfirmModal>
    </>
  );
}

