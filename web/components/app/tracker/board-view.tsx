"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Tag, cx } from "@/design-system";
import { type TrackerField, type TrackerRow, type TrackerView, boardColumns, rowTitle } from "@/lib/tracker";
import { CellDisplay } from "./cells";
import { useTracker } from "./context";
import type { RowOps, ViewSettings } from "./table-view";

/** The fields a card shows under its title: the view's choice, else the first few that aren't the grouping. */
export function cardFields(fields: TrackerField[], settings: ViewSettings, skip: string[] = [], max = 3): TrackerField[] {
  const chosen = settings.config.card_field_ids;
  const pool = fields.filter((f) => !f.is_primary && !skip.includes(f.id) && !settings.hidden_fields.includes(f.id) && f.type !== "long_text");
  return (chosen?.length ? pool.filter((f) => chosen.includes(f.id)) : pool).slice(0, max);
}

export function RowCard({ row, fields, onOpen, draggable, onDragStart, onDragEnd, dragging, onKeyDown, label }: { row: TrackerRow; fields: TrackerField[]; onOpen: () => void; draggable?: boolean; onDragStart?: (e: React.DragEvent) => void; onDragEnd?: () => void; dragging?: boolean; onKeyDown?: (e: React.KeyboardEvent) => void; label?: string }) {
  const { table } = useTracker();
  const shown = fields.filter((f) => {
    const v = row.values[f.id];
    return f.type === "checkbox" ? !!v : v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);
  });
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      aria-label={label}
      className={cx(
        "ds-press block w-full rounded-ds-md border border-hairline bg-surface p-2.5 text-left shadow-[0_1px_0_hsl(var(--ds-border))] hover:border-hairline-strong",
        draggable && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
      )}
    >
      <span className="block text-[13px] font-medium leading-snug">{rowTitle(table, row)}</span>
      {shown.length > 0 && (
        <span className="mt-2 flex flex-col gap-1.5">
          {shown.map((f) => (
            <span key={f.id} className="flex min-w-0 items-center gap-2 text-[12.5px] text-fg-muted">
              <CellDisplay field={f} value={row.values[f.id]} />
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

/**
 * Board: one column per option of a single select (or per person). Drag a card
 * to another column to change it, or within a column to reorder. Keyboard:
 * Alt+← / Alt+→ moves the focused card to the next column.
 */
export function BoardView({ rows, view, settings, ops }: { rows: TrackerRow[]; view: TrackerView; settings: ViewSettings; ops: RowOps }) {
  const { table, members, canEdit } = useTracker();
  const group = table.fields.find((f) => f.id === (settings.config.group_field_id ?? view.config.group_field_id)) ?? table.fields.find((f) => f.type === "single_select");
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ col: string | null; before: string | null } | null>(null);
  const [announce, setAnnounce] = useState("");
  if (!group) return <p className="p-4 text-[13px] text-fg-muted">This board needs a single select field to group by.</p>;
  const columns = boardColumns(group, rows, members);
  const fields = cardFields(table.fields, settings, [group.id]);

  const overColumn = (col: string | null, e: React.DragEvent<HTMLDivElement>) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const cards = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-card]"));
    const before = cards.find((c) => {
      const r = c.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    const beforeId = before?.dataset.card ?? null;
    if (drop?.col !== col || drop?.before !== beforeId) setDrop({ col, before: beforeId === dragId ? null : beforeId });
  };

  const dropOn = (col: string | null) => {
    if (!dragId || !drop) return;
    const row = rows.find((r) => r.id === dragId);
    const changed = row && (row.values[group.id] ?? null) !== col;
    ops.moveRow(dragId, drop.before, changed ? { [group.id]: col } : undefined);
    const label = columns.find((c) => c.id === col)?.label ?? "";
    if (changed) setAnnounce(`Moved to ${label}`);
    setDragId(null);
    setDrop(null);
  };

  const moveByKey = (row: TrackerRow, dir: -1 | 1) => {
    const ids = columns.map((c) => c.id);
    const at = ids.indexOf((row.values[group.id] as string | null) ?? null);
    const next = columns[at + dir];
    if (!next) return;
    ops.updateCell(row.id, group.id, next.id);
    setAnnounce(`${rowTitle(table, row)} moved to ${next.label}`);
  };

  return (
    <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
      <div className="flex h-full gap-3 p-4">
        {columns.map((col) => (
          <section key={col.id ?? "none"} aria-label={col.label} className="flex h-full w-[272px] shrink-0 flex-col">
            <header className="mb-2 flex h-7 items-center gap-2 px-1">
              {col.id ? <Tag tone={col.color}>{col.label}</Tag> : <span className="text-[12.5px] font-medium text-fg-muted">{col.label}</span>}
              <span className="text-[12px] tabular text-fg-faint">{col.rows.length}</span>
            </header>
            <div
              onDragOver={(e) => overColumn(col.id, e)}
              onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDrop((d) => (d?.col === col.id ? null : d))}
              onDrop={(e) => (e.preventDefault(), dropOn(col.id))}
              className={cx("min-h-24 flex-1 space-y-2 overflow-y-auto rounded-ds-lg p-1.5 transition-colors duration-150", drop?.col === col.id ? "bg-surface-2" : "bg-surface-2/40")}
            >
              {col.rows.map((r) => (
                <div key={r.id} data-card={r.id} className="relative">
                  {drop?.col === col.id && drop.before === r.id && <div aria-hidden className="absolute -top-[5px] left-1 right-1 h-0.5 rounded-full bg-ds-accent" />}
                  <RowCard
                    row={r}
                    fields={fields}
                    onOpen={() => ops.openRow(r.id)}
                    draggable={canEdit}
                    dragging={dragId === r.id}
                    label={`${rowTitle(table, r)}, ${col.label}`}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", r.id);
                      setDragId(r.id);
                    }}
                    onDragEnd={() => (setDragId(null), setDrop(null))}
                    onKeyDown={(e) => {
                      if (!canEdit || !e.altKey) return;
                      if (e.key === "ArrowRight") (e.preventDefault(), moveByKey(r, 1));
                      if (e.key === "ArrowLeft") (e.preventDefault(), moveByKey(r, -1));
                    }}
                  />
                </div>
              ))}
              {drop?.col === col.id && drop.before === null && <div aria-hidden className="mx-1 h-0.5 rounded-full bg-ds-accent" />}
              {canEdit && (
                <button
                  type="button"
                  onClick={async () => {
                    const r = await ops.createRow(col.id ? { [group.id]: col.id } : {});
                    if (r) ops.openRow(r.id);
                  }}
                  className="flex h-8 w-full items-center gap-1.5 rounded-ds-sm px-2 text-[12.5px] text-fg-muted hover:bg-surface-2 hover:text-fg [&_svg]:size-3.5"
                >
                  <Plus /> New
                </button>
              )}
            </div>
          </section>
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      {canEdit && <p className="sr-only">Drag cards between columns, or focus a card and press Alt with the left or right arrow to move it.</p>}
    </div>
  );
}
