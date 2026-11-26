// Tracker client: every write the tracker screens make, through /api/proxy so
// the backend JWT is attached server-side. Runs in the browser.

import { proxyFetch } from "./proxy-fetch";
import { type RowQuery, rowsPath } from "./tracker";
import type { CellValue, FieldOptions, FieldType, HistoryEntry, MarketerKind, MarketerObject, RowPage, TrackerField, TrackerRow, TrackerTable, TrackerView, ViewType } from "./tracker";

const T = "/api/v1/tracker";
const seg = encodeURIComponent;

export const trackerApi = {
  createTable: (name: string) => proxyFetch<TrackerTable>(`${T}/tables`, "POST", { name }),
  fromTemplate: (template: string) => proxyFetch<TrackerTable>(`${T}/tables/from-template`, "POST", { template }),
  renameTable: (id: string, name: string) => proxyFetch(`${T}/tables/${seg(id)}`, "PATCH", { name }),
  deleteTable: (id: string) => proxyFetch(`${T}/tables/${seg(id)}`, "DELETE"),
  getTable: (id: string) => proxyFetch<TrackerTable>(`${T}/tables/${seg(id)}`, "GET"),
  rows: (tableId: string, q: RowQuery) => proxyFetch<RowPage>(rowsPath(tableId, q), "GET"),
  createRow: (tableId: string, values: Record<string, CellValue>, beforeId?: string | null) => proxyFetch<TrackerRow>(`${T}/tables/${seg(tableId)}/rows`, "POST", { values, before_id: beforeId ?? null }),
  updateRow: (tableId: string, rowId: string, values: Record<string, CellValue>) => proxyFetch<TrackerRow>(`${T}/tables/${seg(tableId)}/rows/${seg(rowId)}`, "PATCH", { values }),
  moveRow: (tableId: string, rowId: string, beforeId: string | null) => proxyFetch<TrackerRow>(`${T}/tables/${seg(tableId)}/rows/${seg(rowId)}/move`, "POST", { before_id: beforeId }),
  deleteRow: (tableId: string, rowId: string) => proxyFetch(`${T}/tables/${seg(tableId)}/rows/${seg(rowId)}`, "DELETE"),
  history: (tableId: string, rowId: string) => proxyFetch<HistoryEntry[]>(`${T}/tables/${seg(tableId)}/rows/${seg(rowId)}/history`, "GET"),
  createField: (tableId: string, body: { name: string; type: FieldType; options: FieldOptions }) => proxyFetch<TrackerField>(`${T}/tables/${seg(tableId)}/fields`, "POST", body),
  updateField: (tableId: string, fieldId: string, body: { name?: string; options?: FieldOptions }) => proxyFetch<TrackerField>(`${T}/tables/${seg(tableId)}/fields/${seg(fieldId)}`, "PATCH", body),
  deleteField: (tableId: string, fieldId: string) => proxyFetch(`${T}/tables/${seg(tableId)}/fields/${seg(fieldId)}`, "DELETE"),
  createView: (tableId: string, body: { name: string; type: ViewType; config?: TrackerView["config"] }) => proxyFetch<TrackerView>(`${T}/tables/${seg(tableId)}/views`, "POST", body),
  updateView: (tableId: string, viewId: string, patch: Partial<Pick<TrackerView, "name" | "config" | "filters" | "filter_type" | "sorts" | "hidden_fields">>) => proxyFetch<TrackerView>(`${T}/tables/${seg(tableId)}/views/${seg(viewId)}`, "PATCH", patch),
  deleteView: (tableId: string, viewId: string) => proxyFetch(`${T}/tables/${seg(tableId)}/views/${seg(viewId)}`, "DELETE"),
  objects: (kind: MarketerKind, q: string) => proxyFetch<MarketerObject[]>(`${T}/objects?kind=${seg(kind)}&q=${seg(q)}&limit=20`, "GET"),
};

export type TrackerApi = typeof trackerApi;
