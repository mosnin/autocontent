"use client";

import { ArrowDownAZ, ArrowUpAZ, EyeOff, Maximize2, Pencil, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MenuButton, MenuItem, cx } from "@/design-system";
import { type CellValue, type FieldType, type TrackerField, type TrackerRow, type TrackerView, rowTitle, visibleFields } from "@/lib/tracker";
import { CellDisplay, FIELD_ICON, PICKER_TYPES, Picker, TextEditor, fromPicked, isMulti, toPicked, usePickItems } from "./cells";
import { useTracker } from "./context";
import type { RowOps, ViewSettings } from "./table-view";

const DEFAULT_WIDTH: Record<FieldType, number> = {
  text: 180,
  long_text: 260,
  number: 120,
  single_select: 150,
  multi_select: 200,
  date: 140,
  checkbox: 96,
  url: 190,
  person: 170,
  link_row: 200,
  marketer_link: 260,
};

const widthOf = (f: TrackerField, settings: ViewSettings) => settings.config.field_widths?.[f.id] ?? (f.is_primary ? 260 : DEFAULT_WIDTH[f.type]);

function CellPicker({ field, value, onDone, onClose }: { field: TrackerField; value: CellValue | undefined; onDone: (v: CellValue) => void; onClose: () => void }) {
  const { items, loading, onSearch } = usePickItems(field, true);
  const [picked, setPicked] = useState(toPicked(field, value));
  return (
    <div className="absolute left-0 top-full z-30 mt-1">
      <Picker
        label={`Pick ${field.name}`}
        items={items}
        selected={picked}
        multi={isMulti(field.type)}
        loading={loading}
        onSearch={onSearch}
        emptyText={field.type === "single_select" || field.type === "multi_select" ? "No options yet. Add them in the field's settings." : "Nothing to pick yet"}
        onPick={(next) => {
          setPicked(next);
          if (!isMulti(field.type)) onDone(fromPicked(field, next));
        }}
        onClose={() => {
          if (isMulti(field.type)) onDone(fromPicked(field, picked));
          onClose();
        }}
      />
    </div>
  );
}

/**
 * The grid: one row per record, one column per visible field. Keyboard first:
 * arrows move, Enter or typing edits, Esc cancels, Tab commits and moves on,
 * Delete clears, Space (or Shift+Enter) opens the row.
 */
export function GridView({ rows, view, settings, ops, total }: { rows: TrackerRow[]; view: TrackerView; settings: ViewSettings; ops: RowOps; total: number; onLoadMore?: () => void }) {
  const { table, canEdit, canManage } = useTracker();
  const fields = visibleFields(table, settings);
  const [active, setActive] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const [editing, setEditing] = useState<{ initial?: string } | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const gridRef = useRef<HTMLDivElement>(null);
  const focusAfterCreate = useRef<string | null>(null);

  const clamp = (r: number, c: number) => ({ r: Math.max(0, Math.min(rows.length - 1, r)), c: Math.max(0, Math.min(fields.length - 1, c)) });

  // Keep focus on the active cell when it moves (not while an editor holds it).
  useLayoutEffect(() => {
    if (editing) return;
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${active.r}:${active.c}"]`);
    if (el && gridRef.current?.contains(document.activeElement)) el.focus({ preventScroll: false });
  }, [active, editing]);

  // A row just added from the last line: put the cursor in its first cell and edit.
  useEffect(() => {
    const id = focusAfterCreate.current;
    if (!id) return;
    const r = rows.findIndex((x) => x.id === id);
    if (r >= 0) {
      focusAfterCreate.current = null;
      setActive({ r, c: 0 });
      setEditing({});
    }
  }, [rows]);

  const row = rows[active.r];
  const field = fields[active.c];

  const commit = (v: CellValue, move?: "down" | "right" | "left" | null) => {
    if (row && field && JSON.stringify(row.values[field.id] ?? null) !== JSON.stringify(v)) ops.updateCell(row.id, field.id, v);
    setEditing(null);
    if (move === "down") setActive((a) => clamp(a.r + 1, a.c));
    if (move === "right") setActive((a) => clamp(a.r, a.c + 1));
    if (move === "left") setActive((a) => clamp(a.r, a.c - 1));
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>('[tabindex="0"][data-cell]')?.focus());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing || !row || !field) return;
    const k = e.key;
    const moves: Record<string, [number, number]> = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1] };
    if (moves[k]) {
      e.preventDefault();
      const [dr, dc] = moves[k]!;
      setActive((a) => clamp(a.r + dr, a.c + dc));
    } else if (k === "Tab") {
      const next = clamp(active.r, active.c + (e.shiftKey ? -1 : 1));
      if (next.c !== active.c) (e.preventDefault(), setActive(next));
    } else if (k === "Home") (e.preventDefault(), setActive((a) => clamp(e.ctrlKey || e.metaKey ? 0 : a.r, 0)));
    else if (k === "End") (e.preventDefault(), setActive((a) => clamp(e.ctrlKey || e.metaKey ? rows.length - 1 : a.r, fields.length - 1)));
    else if (k === "Enter" && e.shiftKey) (e.preventDefault(), ops.openRow(row.id));
    else if (k === " " && field.type !== "checkbox") (e.preventDefault(), ops.openRow(row.id));
    else if (!canEdit) return;
    else if ((k === "Enter" || k === " ") && field.type === "checkbox") (e.preventDefault(), ops.updateCell(row.id, field.id, !row.values[field.id]));
    else if (k === "Enter" || k === "F2") (e.preventDefault(), setEditing({}));
    else if (k === "Backspace" || k === "Delete") (e.preventDefault(), ops.updateCell(row.id, field.id, field.type === "checkbox" ? false : null));
    else if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && field.type !== "checkbox") {
      e.preventDefault();
      setEditing(PICKER_TYPES.includes(field.type) || field.type === "date" ? {} : { initial: k });
    }
  };

  const startResize = (f: TrackerField, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const start = widths[f.id] ?? widthOf(f, settings);
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    let last = start;
    const move = (ev: PointerEvent) => {
      last = Math.round(Math.min(640, Math.max(80, start + ev.clientX - startX)));
      setWidths((w) => ({ ...w, [f.id]: last }));
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      ops.setSettings({ config: { ...settings.config, field_widths: { ...(settings.config.field_widths ?? {}), [f.id]: last } } });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const sortBy = (f: TrackerField, direction: "asc" | "desc") => ops.setSettings({ sorts: [{ field_id: f.id, direction }] });
  const colWidth = (f: TrackerField) => widths[f.id] ?? widthOf(f, settings);
  const totalWidth = 48 + fields.reduce((n, f) => n + colWidth(f), 0);

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div
        ref={gridRef}
        role="grid"
        aria-label={`${table.name}, ${view.name}`}
        aria-rowcount={rows.length + 1}
        aria-colcount={fields.length}
        onKeyDown={onKeyDown}
        className="relative min-w-full text-[13px]"
        style={{ width: totalWidth }}
      >
        <div role="row" aria-rowindex={1} className="sticky top-0 z-20 flex h-9 border-b border-hairline bg-ds-bg">
          <div className="sticky left-0 z-10 w-12 shrink-0 border-r border-hairline bg-ds-bg" aria-hidden />
          {fields.map((f, c) => (
            <div key={f.id} role="columnheader" aria-colindex={c + 1} className={cx("group relative flex shrink-0 items-center border-r border-hairline", f.is_primary && "sticky left-12 z-10 bg-ds-bg")} style={{ width: colWidth(f) }}>
              <MenuButton
                label={`${f.name} options`}
                trigger={() => (
                  <button type="button" className="flex h-9 w-full min-w-0 items-center gap-1.5 px-2.5 text-left text-[12.5px] font-medium text-fg-muted hover:text-fg [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-fg-faint">
                    {FIELD_ICON[f.type]}
                    <span className="truncate">{f.name}</span>
                  </button>
                )}
              >
                {(close) => (
                  <>
                    {canManage && (
                      <MenuItem icon={<Pencil />} onClick={() => (close(), ops.editField(f.id))}>
                        Edit field
                      </MenuItem>
                    )}
                    <MenuItem icon={<ArrowDownAZ />} onClick={() => (close(), sortBy(f, "asc"))}>
                      Sort A → Z
                    </MenuItem>
                    <MenuItem icon={<ArrowUpAZ />} onClick={() => (close(), sortBy(f, "desc"))}>
                      Sort Z → A
                    </MenuItem>
                    {!f.is_primary && (
                      <MenuItem icon={<EyeOff />} onClick={() => (close(), ops.setSettings({ hidden_fields: [...settings.hidden_fields, f.id] }))}>
                        Hide in this view
                      </MenuItem>
                    )}
                  </>
                )}
              </MenuButton>
              <span
                role="separator"
                aria-orientation="vertical"
                aria-label={`Resize ${f.name}`}
                onPointerDown={(e) => startResize(f, e)}
                className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize opacity-0 transition-opacity duration-150 hover:opacity-100 group-hover:opacity-60 after:absolute after:left-[3px] after:top-2 after:h-5 after:w-0.5 after:rounded-full after:bg-ds-accent"
              />
            </div>
          ))}
          {canManage && (
            <button type="button" onClick={() => ops.editField("new")} aria-label="Add a field" className="flex h-9 w-10 shrink-0 items-center justify-center text-fg-faint hover:text-fg [&_svg]:size-4">
              <Plus />
            </button>
          )}
        </div>

        {rows.map((r, ri) => (
          <div key={r.id} role="row" aria-rowindex={ri + 2} className={cx("group/row flex h-[34px] border-b border-hairline", active.r === ri ? "bg-surface" : "hover:bg-surface")}>
            <div className={cx("sticky left-0 z-10 flex w-12 shrink-0 items-center justify-between border-r border-hairline pl-2.5 pr-1 text-[12px] tabular text-fg-faint", active.r === ri ? "bg-surface" : "bg-ds-bg group-hover/row:bg-surface")}>
              <span className="group-hover/row:hidden">{ri + 1}</span>
              <button type="button" tabIndex={-1} aria-label={`Open ${rowTitle(table, r)}`} onClick={() => ops.openRow(r.id)} className="hidden size-6 items-center justify-center rounded-ds-sm text-fg-muted hover:bg-surface-3 hover:text-fg group-hover/row:flex [&_svg]:size-3.5">
                <Maximize2 />
              </button>
            </div>
            {fields.map((f, ci) => {
              const isActive = active.r === ri && active.c === ci;
              const isEditing = isActive && editing !== null;
              return (
                <div
                  key={f.id}
                  role="gridcell"
                  aria-colindex={ci + 1}
                  aria-selected={isActive}
                  aria-readonly={!canEdit || undefined}
                  data-cell={`${ri}:${ci}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => {
                    if (isActive && canEdit && !editing) {
                      if (f.type === "checkbox") ops.updateCell(r.id, f.id, !r.values[f.id]);
                      else setEditing({});
                    } else setActive({ r: ri, c: ci });
                  }}
                  onDoubleClick={() => canEdit && f.type !== "checkbox" && (setActive({ r: ri, c: ci }), setEditing({}))}
                  className={cx(
                    "relative flex shrink-0 items-center overflow-visible border-r border-hairline px-2.5 outline-none",
                    f.type === "number" && "justify-end",
                    f.type === "checkbox" && "justify-center",
                    f.is_primary && cx("sticky left-12 z-[5] font-medium", active.r === ri ? "bg-surface" : "bg-ds-bg group-hover/row:bg-surface"),
                    isActive && "z-[6] shadow-[inset_0_0_0_2px_hsl(var(--ds-accent))]",
                  )}
                  style={{ width: colWidth(f) }}
                >
                  {!isEditing && (
                    <span className="flex min-w-0 max-w-full items-center overflow-hidden">
                      <CellDisplay field={f} value={r.values[f.id]} />
                    </span>
                  )}
                  {isEditing && PICKER_TYPES.includes(f.type) && (
                    <>
                      <span className="flex min-w-0 max-w-full items-center overflow-hidden">
                        <CellDisplay field={f} value={r.values[f.id]} />
                      </span>
                      <CellPicker field={f} value={r.values[f.id]} onDone={(v) => commit(v)} onClose={() => (setEditing(null), requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>('[tabindex="0"][data-cell]')?.focus()))} />
                    </>
                  )}
                  {isEditing && !PICKER_TYPES.includes(f.type) && f.type !== "checkbox" && (
                    <div className={cx("absolute left-0 top-0 z-30", f.type === "long_text" ? "w-[max(100%,320px)]" : "w-[max(100%,180px)]")}>
                      <TextEditor
                        inline
                        field={f}
                        value={r.values[f.id]}
                        initial={editing?.initial}
                        onCommit={commit}
                        onCancel={() => (setEditing(null), requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>('[tabindex="0"][data-cell]')?.focus()))}
                        className="!h-[34px] rounded-none border-ds-accent shadow-ds-float"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {canEdit && (
          <button
            type="button"
            onClick={async () => {
              const created = await ops.createRow();
              if (created) focusAfterCreate.current = created.id;
            }}
            className="sticky left-0 flex h-[34px] items-center gap-2 px-3 text-[13px] text-fg-muted hover:text-fg [&_svg]:size-3.5"
          >
            <Plus /> New row
          </button>
        )}
        {rows.length === 0 && (
          <p className="sticky left-0 max-w-md px-4 py-6 text-[13px] text-fg-muted">
            {total === 0 ? (canEdit ? "No rows yet. Add the first one, or ask Marketer to fill this in." : "No rows yet.") : "No rows match this view's filters or search."}
          </p>
        )}
      </div>
      {rows.length > 0 && <p className="sr-only" aria-live="polite">{`${rows.length} rows`}</p>}
    </div>
  );
}
