"use client";

import { CalendarDays, Columns3, EyeOff, Filter, LayoutGrid, MoreHorizontal, Plus, Rows3, Search, SlidersHorizontal, ArrowUpDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ConfirmModal, IconButton, Input, MenuButton, MenuItem, Notice, PageHeader, Segmented, cx, useAllowed } from "@/design-system";
import {
  type CellValue,
  type MarketerKind,
  type MarketerObject,
  type Member,
  type Resolved,
  type RowPage,
  type TrackerField,
  type TrackerFilter,
  type TrackerRow,
  type TrackerSort,
  type TrackerTable,
  type TrackerTableSummary,
  type TrackerView,
  type ViewType,
  VIEW_LABEL,
  describeFilter,
  matchesFilter,
  completeFilters,
} from "@/lib/tracker";
import { trackerApi } from "@/lib/tracker-client";
import { BoardView } from "./board-view";
import { CalendarView } from "./calendar-view";
import { TrackerContext, type TrackerCtx } from "./context";
import { FieldSheet } from "./field-sheet";
import { GalleryView } from "./gallery-view";
import { GridView } from "./grid-view";
import { RowSheet } from "./row-sheet";
import { FieldsPanel, FilterPanel, SortPanel } from "./view-controls";

export const VIEW_ICON: Record<ViewType, ReactNode> = { grid: <Rows3 />, board: <Columns3 />, calendar: <CalendarDays />, gallery: <LayoutGrid /> };

export type ViewSettings = Pick<TrackerView, "filters" | "filter_type" | "sorts" | "hidden_fields" | "config">;

export interface RowOps {
  updateCell: (rowId: string, fieldId: string, value: CellValue) => void;
  updateRow: (rowId: string, values: Record<string, CellValue>) => Promise<void>;
  createRow: (values?: Record<string, CellValue>, beforeId?: string | null) => Promise<TrackerRow | null>;
  deleteRow: (rowId: string) => Promise<void>;
  moveRow: (rowId: string, beforeId: string | null, values?: Record<string, CellValue>) => void;
  openRow: (rowId: string) => void;
  editField: (fieldId: string | "new") => void;
  setSettings: (patch: Partial<ViewSettings>) => void;
}

export interface PreviewData {
  rowsByTable: Record<string, TrackerRow[]>;
  tablesById: Record<string, TrackerTable>;
  objects: MarketerObject[];
}

const PAGE = 500;

function settingsOf(v: TrackerView): ViewSettings {
  return { filters: v.filters, filter_type: v.filter_type, sorts: v.sorts, hidden_fields: v.hidden_fields, config: v.config };
}

function sortRows(rows: TrackerRow[], sorts: TrackerSort[], fields: TrackerField[]): TrackerRow[] {
  if (!sorts.length) return [...rows].sort((a, b) => a.position - b.position);
  return [...rows].sort((a, b) => {
    for (const s of sorts) {
      const f = fields.find((x) => x.id === s.field_id);
      if (!f) continue;
      const rank = (r: TrackerRow): string | number | null => {
        const v = r.values[f.id];
        if (v === null || v === undefined || v === "") return null;
        if (f.type === "single_select") return (f.options.choices ?? []).findIndex((c) => c.id === v);
        if (typeof v === "number") return v;
        if (typeof v === "boolean") return v ? 1 : 0;
        return String(Array.isArray(v) ? (v[0] ?? "") : v).toLowerCase();
      };
      const x = rank(a);
      const y = rank(b);
      if (x === y) continue;
      if (x === null) return 1;
      if (y === null) return -1;
      const c = x < y ? -1 : 1;
      return s.direction === "desc" ? -c : c;
    }
    return a.position - b.position;
  });
}

export function TrackerTableView({
  table: initialTable,
  tables,
  page,
  members,
  initialViewId,
  preview,
  initialRowId,
}: {
  table: TrackerTable;
  tables: TrackerTableSummary[];
  page: RowPage | null;
  members: Member[];
  initialViewId?: string;
  /** Fixture preview: everything works, nothing is sent. */
  preview?: PreviewData;
  initialRowId?: string;
}) {
  const router = useRouter();
  const canEdit = useAllowed("content:update");
  const canDelete = useAllowed("content:delete");
  const canManage = useAllowed("playbook:update");
  const canDeleteTable = useAllowed("playbook:delete");
  const [table, setTable] = useState(initialTable);
  const [viewId, setViewId] = useState(initialViewId && initialTable.views.some((v) => v.id === initialViewId) ? initialViewId : initialTable.views[0]?.id);
  const [settings, setSettingsMap] = useState<Record<string, ViewSettings>>(() => Object.fromEntries(initialTable.views.map((v) => [v.id, settingsOf(v)])));
  const [allRows, setAllRows] = useState<TrackerRow[]>(preview ? (preview.rowsByTable[initialTable.id] ?? []) : (page?.rows ?? []));
  const [total, setTotal] = useState(page?.total ?? allRows.length);
  const [resolved, setResolved] = useState<Resolved>(page?.resolved ?? { rows: {}, objects: {} });
  const [loadError, setLoadError] = useState<string | null>(!preview && page === null ? "Couldn't load the rows. Refresh to try again." : null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [openRowId, setOpenRowId] = useState<string | null>(initialRowId ?? null);
  const [fieldSheet, setFieldSheet] = useState<string | "new" | null>(null);
  const [confirmDeleteTable, setConfirmDeleteTable] = useState(false);
  const view = table.views.find((v) => v.id === viewId) ?? table.views[0]!;
  const current = settings[view.id] ?? settingsOf(view);

  // ---------------------------------------------------------------- reads
  const seq = useRef(0);
  const refresh = useCallback(
    async (s: ViewSettings = current, search = q) => {
      if (preview) return;
      const n = ++seq.current;
      try {
        const res = await trackerApi.rows(table.id, { filters: completeFilters(s.filters), filterType: s.filter_type, sorts: s.sorts, q: search, limit: PAGE });
        if (n !== seq.current) return;
        setAllRows(res.rows);
        setTotal(res.total);
        setResolved(res.resolved);
        setLoadError(null);
      } catch (e) {
        if (n === seq.current) setLoadError(e instanceof Error ? e.message : "Couldn't load the rows.");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preview, table.id, view.id, settings, q],
  );

  // Search: debounce, then ask the server (the preview filters locally).
  const firstSearch = useRef(true);
  useEffect(() => {
    if (firstSearch.current) {
      firstSearch.current = false;
      return;
    }
    const t = setTimeout(() => void refresh(current, q), 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const rows = useMemo(() => {
    if (!preview) return allRows;
    const fields = table.fields;
    let out = allRows.filter((r) => {
      const results = completeFilters(current.filters).map((f) => {
        const field = fields.find((x) => x.id === f.field_id);
        return field ? matchesFilter(field, f, r.values[f.field_id] ?? null) : true;
      });
      if (!results.length) return true;
      return current.filter_type === "or" ? results.some(Boolean) : results.every(Boolean);
    });
    const needle = q.trim().toLowerCase();
    if (needle) out = out.filter((r) => fields.some((f) => ["text", "long_text", "url"].includes(f.type) && String(r.values[f.id] ?? "").toLowerCase().includes(needle)));
    return sortRows(out, current.sorts, fields);
  }, [preview, allRows, current, q, table.fields]);

  // ---------------------------------------------------------------- view settings
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setSettings = useCallback(
    (patch: Partial<ViewSettings>) => {
      const next = { ...current, ...patch };
      setSettingsMap((m) => ({ ...m, [view.id]: next }));
      if (patch.filters || patch.sorts || patch.filter_type) void refresh(next);
      if (preview || !canManage) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        trackerApi.updateView(table.id, view.id, { ...next, filters: completeFilters(next.filters) }).catch((e) => setError(e instanceof Error ? e.message : "Couldn't save the view."));
      }, 400);
    },
    [current, view.id, refresh, preview, canManage, table.id],
  );

  const switchView = (id: string) => {
    setViewId(id);
    const s = settings[id];
    if (s && !preview) void refresh(s);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("view", id);
      window.history.replaceState(null, "", url.toString());
    }
  };

  // ---------------------------------------------------------------- writes
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
  const linkish = (values: Record<string, CellValue>) => Object.keys(values).some((id) => ["link_row", "marketer_link"].includes(table.fields.find((f) => f.id === id)?.type ?? ""));

  const updateRow = async (rowId: string, values: Record<string, CellValue>) => {
    const before = allRows.find((r) => r.id === rowId);
    setAllRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, values: { ...r.values, ...values }, updated_at: new Date().toISOString() } : r)));
    setError(null);
    if (preview) return;
    try {
      const saved = await trackerApi.updateRow(table.id, rowId, values);
      setAllRows((rs) => rs.map((r) => (r.id === rowId ? saved : r)));
      if (linkish(values)) void refresh();
    } catch (e) {
      if (before) setAllRows((rs) => rs.map((r) => (r.id === rowId ? before : r)));
      fail(e);
    }
  };

  const ops: RowOps = {
    updateCell: (rowId, fieldId, value) => void updateRow(rowId, { [fieldId]: value }),
    updateRow,
    createRow: async (values = {}, beforeId = null) => {
      setError(null);
      if (preview) {
        const pos = beforeId ? (allRows.find((r) => r.id === beforeId)?.position ?? 0) - 0.5 : Math.max(0, ...allRows.map((r) => r.position)) + 1;
        const row: TrackerRow = { id: crypto.randomUUID(), table_id: table.id, position: pos, values, created_by: null, updated_by: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        setAllRows((rs) => [...rs, row]);
        setTotal((t) => t + 1);
        return row;
      }
      try {
        const row = await trackerApi.createRow(table.id, values, beforeId);
        setAllRows((rs) => [...rs, row]);
        setTotal((t) => t + 1);
        if (linkish(values)) void refresh();
        return row;
      } catch (e) {
        fail(e);
        return null;
      }
    },
    deleteRow: async (rowId) => {
      const before = allRows;
      setAllRows((rs) => rs.filter((r) => r.id !== rowId));
      setTotal((t) => t - 1);
      if (openRowId === rowId) setOpenRowId(null);
      if (preview) return;
      try {
        await trackerApi.deleteRow(table.id, rowId);
      } catch (e) {
        setAllRows(before);
        setTotal((t) => t + 1);
        fail(e);
      }
    },
    moveRow: (rowId, beforeId, values) => {
      const target = beforeId ? allRows.find((r) => r.id === beforeId) : null;
      const prev = target ? Math.max(-Infinity, ...allRows.filter((r) => r.position < target.position && r.id !== rowId).map((r) => r.position)) : null;
      const pos = target ? (Number.isFinite(prev) ? ((prev as number) + target.position) / 2 : target.position - 1) : Math.max(0, ...allRows.map((r) => r.position)) + 1;
      setAllRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, position: pos, values: { ...r.values, ...(values ?? {}) } } : r)));
      if (preview) return;
      (async () => {
        try {
          if (values && Object.keys(values).length) await trackerApi.updateRow(table.id, rowId, values);
          await trackerApi.moveRow(table.id, rowId, beforeId);
        } catch (e) {
          fail(e);
          void refresh();
        }
      })();
    },
    openRow: (rowId) => setOpenRowId(rowId),
    editField: (fieldId) => setFieldSheet(fieldId),
    setSettings,
  };

  // ---------------------------------------------------------------- views and fields
  const addView = async (type: ViewType) => {
    const name = `${VIEW_LABEL[type]}${table.views.some((v) => v.name === VIEW_LABEL[type]) ? ` ${table.views.filter((v) => v.type === type).length + 1}` : ""}`;
    setError(null);
    if (type === "board" && !table.fields.some((f) => f.type === "single_select" || f.type === "person")) return setError("A board groups rows by a single select or person field. Add one first.");
    if (type === "calendar" && !table.fields.some((f) => f.type === "date")) return setError("A calendar places rows by a date field. Add one first.");
    let v: TrackerView;
    if (preview) {
      const group = table.fields.find((f) => f.type === "single_select")?.id;
      const date = table.fields.find((f) => f.type === "date")?.id;
      v = { id: crypto.randomUUID(), table_id: table.id, name, type, config: type === "board" ? { group_field_id: group } : type === "calendar" ? { date_field_id: date } : {}, filters: [], filter_type: "and", sorts: [], hidden_fields: [], position: table.views.length };
    } else {
      try {
        v = await trackerApi.createView(table.id, { name, type });
      } catch (e) {
        return fail(e);
      }
    }
    setTable((t) => ({ ...t, views: [...t.views, v] }));
    setSettingsMap((m) => ({ ...m, [v.id]: settingsOf(v) }));
    switchView(v.id);
  };

  const deleteView = async () => {
    if (table.views.length <= 1) return;
    const rest = table.views.filter((v) => v.id !== view.id);
    if (!preview) {
      try {
        await trackerApi.deleteView(table.id, view.id);
      } catch (e) {
        return fail(e);
      }
    }
    setTable((t) => ({ ...t, views: rest }));
    switchView(rest[0]!.id);
  };

  const onFieldSaved = (field: TrackerField, removed?: boolean) => {
    setTable((t) => ({ ...t, fields: removed ? t.fields.filter((f) => f.id !== field.id) : t.fields.some((f) => f.id === field.id) ? t.fields.map((f) => (f.id === field.id ? field : f)) : [...t.fields, field] }));
    if (removed) setAllRows((rs) => rs.map((r) => ({ ...r, values: Object.fromEntries(Object.entries(r.values).filter(([k]) => k !== field.id)) })));
    setFieldSheet(null);
  };

  const deleteTable = async () => {
    if (!preview) {
      try {
        await trackerApi.deleteTable(table.id);
      } catch (e) {
        setConfirmDeleteTable(false);
        return fail(e);
      }
    }
    router.push("/tracker");
  };

  const ctx: TrackerCtx = {
    table,
    tables,
    members,
    resolved,
    canEdit,
    canDelete,
    canManage,
    preview: !!preview,
    searchObjects: async (kind: MarketerKind, query: string) => {
      if (preview) return preview.objects.filter((o) => o.kind === kind && o.title.toLowerCase().includes(query.toLowerCase()));
      return trackerApi.objects(kind, query);
    },
    linkedRows: async (tableId: string) => {
      if (preview) {
        const rs = preview.rowsByTable[tableId] ?? [];
        return { rows: rs, total: rs.length, limit: rs.length, offset: 0, resolved: { rows: {}, objects: {} }, table: preview.tablesById[tableId] };
      }
      const [t, p] = await Promise.all([trackerApi.getTable(tableId), trackerApi.rows(tableId, { limit: 200 })]);
      return { ...p, table: t };
    },
  };

  // Preview: picking a link resolves it locally so the cell shows the item at once.
  if (preview) {
    const objs = Object.fromEntries(preview.objects.map((o) => [`${o.kind}:${o.id}`, o]));
    const rowTitles: Record<string, string> = {};
    for (const [tid, rs] of Object.entries(preview.rowsByTable)) {
      const p = preview.tablesById[tid]?.fields.find((f) => f.is_primary);
      for (const r of rs) rowTitles[r.id] = (p && typeof r.values[p.id] === "string" ? (r.values[p.id] as string) : "") || "Untitled";
    }
    ctx.resolved = { rows: { ...rowTitles, ...resolved.rows }, objects: { ...objs, ...resolved.objects } };
  }

  const openRow = rows.find((r) => r.id === openRowId) ?? allRows.find((r) => r.id === openRowId) ?? null;
  const activeFilters = current.filters.length;

  return (
    <TrackerContext.Provider value={ctx}>
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader
          crumbs={[{ label: "Tracker", href: preview ? "/preview/app/tracker" : "/tracker" }, { label: table.name }]}
          actions={
            <>
              {canManage && (
                <Button variant="ghost" size="md" onClick={() => setFieldSheet("new")} className="hidden sm:inline-flex">
                  <Plus /> Field
                </Button>
              )}
              {canEdit && (
                <Button
                  variant="primary"
                  onClick={async () => {
                    const r = await ops.createRow();
                    if (r) setOpenRowId(r.id);
                  }}
                >
                  <Plus /> New row
                </Button>
              )}
              {(canManage || canDeleteTable) && (
                <MenuButton align="right" label="Table actions" trigger={() => <IconButton label="Table actions"><MoreHorizontal /></IconButton>}>
                  {(close) => (
                    <>
                      {canManage && (
                        <MenuItem icon={<Plus />} onClick={() => (close(), setFieldSheet("new"))}>
                          Add a field
                        </MenuItem>
                      )}
                      {canManage && table.views.length > 1 && (
                        <MenuItem icon={<EyeOff />} onClick={() => (close(), void deleteView())}>
                          Delete view “{view.name}”
                        </MenuItem>
                      )}
                      {canDeleteTable && (
                        <MenuItem onClick={() => (close(), setConfirmDeleteTable(true))}>
                          <span className="text-negative">Delete table</span>
                        </MenuItem>
                      )}
                    </>
                  )}
                </MenuButton>
              )}
            </>
          }
        />

        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-2">
          <div className="-mx-1 flex min-w-0 max-w-full items-center gap-1 overflow-x-auto px-1">
            <Segmented
              label="Views"
              size="sm"
              value={view.id}
              onChange={switchView}
              options={table.views.map((v) => ({ value: v.id, label: <span className="flex items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:text-fg-muted">{VIEW_ICON[v.type]}{v.name}</span> }))}
            />
            {canManage && (
              <MenuButton label="Add a view" trigger={() => <IconButton label="Add a view"><Plus /></IconButton>}>
                {(close) =>
                  (["grid", "board", "calendar", "gallery"] as ViewType[]).map((t) => (
                    <MenuItem key={t} icon={VIEW_ICON[t]} onClick={() => (close(), void addView(t))}>
                      {VIEW_LABEL[t]}
                    </MenuItem>
                  ))
                }
              </MenuButton>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <label className="relative hidden sm:block">
              <span className="sr-only">Search rows</span>
              <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-faint" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="!h-7 w-40 pl-7 text-[12.5px]" />
            </label>
            <FilterPanel
              fields={table.fields}
              members={members}
              filters={current.filters}
              filterType={current.filter_type}
              onChange={(filters: TrackerFilter[], filter_type) => setSettings({ filters, filter_type })}
              trigger={({ toggle, open: _open, ...p }) => (
                <Button {...p} onClick={toggle} variant={activeFilters ? "secondary" : "ghost"} size="sm" className={cx(activeFilters > 0 && "text-ds-accent")}>
                  <Filter /> {activeFilters ? `${activeFilters} filter${activeFilters > 1 ? "s" : ""}` : <span className="hidden md:inline">Filter</span>}
                </Button>
              )}
            />
            <SortPanel
              fields={table.fields}
              sorts={current.sorts}
              onChange={(sorts) => setSettings({ sorts })}
              trigger={({ toggle, open: _open, ...p }) => (
                <Button {...p} onClick={toggle} variant={current.sorts.length ? "secondary" : "ghost"} size="sm" className={cx(current.sorts.length > 0 && "text-ds-accent")}>
                  <ArrowUpDown /> <span className="hidden md:inline">{current.sorts.length ? `Sorted` : "Sort"}</span>
                </Button>
              )}
            />
            {(view.type === "grid" || view.type === "gallery") && (
              <FieldsPanel
                fields={table.fields}
                hidden={current.hidden_fields}
                onChange={(hidden_fields) => setSettings({ hidden_fields })}
                trigger={({ toggle, open: _open, ...p }) => (
                  <Button {...p} onClick={toggle} variant={current.hidden_fields.length ? "secondary" : "ghost"} size="sm">
                    <SlidersHorizontal /> <span className="hidden md:inline">{current.hidden_fields.length ? `${current.hidden_fields.length} hidden` : "Fields"}</span>
                  </Button>
                )}
              />
            )}
          </div>
          {current.filters.length > 0 && (
            <p className="w-full truncate text-[12px] text-fg-muted">
              {current.filters.map((f) => describeFilter(table.fields, f, members)).join(current.filter_type === "or" ? " or " : " and ")}
              {!canManage && !preview && " · not saved to the view for your role"}
            </p>
          )}
        </div>

        {(error || loadError) && (
          <div className="px-4 pt-3">
            <Notice error={error ?? loadError} />
          </div>
        )}

        <div key={view.id} className="ds-enter flex min-h-0 flex-1 flex-col">
          {view.type === "grid" && <GridView rows={rows} view={view} settings={current} ops={ops} total={total} onLoadMore={undefined} />}
          {view.type === "board" && <BoardView rows={rows} view={view} settings={current} ops={ops} />}
          {view.type === "calendar" && <CalendarView rows={rows} view={view} settings={current} ops={ops} />}
          {view.type === "gallery" && <GalleryView rows={rows} settings={current} ops={ops} />}
        </div>
        {!preview && total > allRows.length && <p className="border-t border-hairline px-4 py-2 text-[12px] text-fg-muted">Showing the first {allRows.length.toLocaleString()} of {total.toLocaleString()} rows. Filter or search to narrow it down.</p>}
      </div>

      <RowSheet row={openRow} onClose={() => setOpenRowId(null)} ops={ops} preview={!!preview} />
      <FieldSheet open={fieldSheet !== null} fieldId={fieldSheet === "new" ? null : fieldSheet} onClose={() => setFieldSheet(null)} onSaved={onFieldSaved} preview={!!preview} />
      <ConfirmModal open={confirmDeleteTable} onClose={() => setConfirmDeleteTable(false)} title={`Delete “${table.name}”?`} confirmLabel="Delete table" danger onConfirm={() => void deleteTable()}>
        Its {total.toLocaleString()} rows, views and history go with it, and link fields in other tables that point here are removed. This can't be undone.
      </ConfirmModal>
    </TrackerContext.Provider>
  );
}
