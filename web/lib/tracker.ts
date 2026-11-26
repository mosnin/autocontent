// Tracker: wire types and pure helpers shared by the server pages, the client
// views and the preview fixtures. Nothing here touches the network or the DOM,
// so web/test/tracker.test.ts runs it under plain node.

export type FieldType =
  | "text"
  | "long_text"
  | "number"
  | "single_select"
  | "multi_select"
  | "date"
  | "checkbox"
  | "url"
  | "person"
  | "link_row"
  | "marketer_link";

export type MarketerKind = "video" | "carousel" | "article" | "campaign";
export type ViewType = "grid" | "board" | "calendar" | "gallery";

export interface Choice {
  id: string;
  label: string;
  color: string;
}

export interface FieldOptions {
  choices?: Choice[];
  decimals?: number;
  prefix?: string;
  suffix?: string;
  include_time?: boolean;
  table_id?: string;
  kind?: MarketerKind;
}

export interface TrackerField {
  id: string;
  table_id: string;
  name: string;
  type: FieldType;
  options: FieldOptions;
  position: number;
  is_primary: boolean;
}

export interface TrackerFilter {
  field_id: string;
  op: string;
  value: unknown;
}

export interface TrackerSort {
  field_id: string;
  direction: "asc" | "desc";
}

export interface TrackerView {
  id: string;
  table_id: string;
  name: string;
  type: ViewType;
  config: { group_field_id?: string; date_field_id?: string; card_field_ids?: string[]; field_widths?: Record<string, number>; field_order?: string[] };
  filters: TrackerFilter[];
  filter_type: "and" | "or";
  sorts: TrackerSort[];
  hidden_fields: string[];
  position: number;
}

export interface TrackerTableSummary {
  id: string;
  name: string;
  description: string;
  template: string | null;
  created_at: string;
  updated_at: string;
  row_count?: number;
}

export interface TrackerTable extends TrackerTableSummary {
  fields: TrackerField[];
  views: TrackerView[];
}

export type CellValue = string | number | boolean | string[] | null;

export interface TrackerRow {
  id: string;
  table_id: string;
  position: number;
  values: Record<string, CellValue>;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MarketerObject {
  kind: MarketerKind;
  id: string;
  title: string;
  status: string;
  platform: string | null;
  at: string | null;
  href: string;
  metrics: Record<string, string | number>;
}

export interface Resolved {
  rows: Record<string, string>;
  objects: Record<string, MarketerObject>;
}

export interface RowPage {
  rows: TrackerRow[];
  total: number;
  limit: number;
  offset: number;
  resolved: Resolved;
}

export interface Member {
  id: string;
  name: string;
  email?: string;
}

export interface TemplateInfo {
  key: string;
  name: string;
  description: string;
  fields: string[];
  views: ViewType[];
}

export interface HistoryEntry {
  id: number;
  action: "created" | "updated" | "deleted";
  changes: Record<string, { before: CellValue; after: CellValue }>;
  actor_id: string | null;
  actor_type: string;
  at: string;
}

export interface RowQuery {
  viewId?: string;
  filters?: TrackerFilter[];
  sorts?: TrackerSort[];
  filterType?: "and" | "or";
  q?: string;
  limit?: number;
  offset?: number;
}

export function rowsPath(tableId: string, q: RowQuery = {}): string {
  const p = new URLSearchParams();
  if (q.viewId) p.set("view_id", q.viewId);
  if (q.filters?.length) p.set("filters", JSON.stringify(q.filters));
  if (q.filterType) p.set("filter_type", q.filterType);
  if (q.sorts) p.set("sorts", JSON.stringify(q.sorts));
  if (q.q) p.set("q", q.q);
  p.set("limit", String(q.limit ?? 200));
  if (q.offset) p.set("offset", String(q.offset));
  return `/api/v1/tracker/tables/${encodeURIComponent(tableId)}/rows?${p.toString()}`;
}

// ------------------------------------------------------------------ labels

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text: "Text",
  long_text: "Long text",
  number: "Number",
  single_select: "Single select",
  multi_select: "Multiple select",
  date: "Date",
  checkbox: "Checkbox",
  url: "Link",
  person: "Person",
  link_row: "Link to a row",
  marketer_link: "Marketer item",
};

export const FIELD_TYPE_HINT: Record<FieldType, string> = {
  text: "A short line",
  long_text: "Notes, captions, briefs",
  number: "Counts, budgets, percentages",
  single_select: "One option, with a colour",
  multi_select: "Several options",
  date: "A day, optionally with a time",
  checkbox: "Done or not",
  url: "A web address",
  person: "Someone in this workspace",
  link_row: "Rows of another table",
  marketer_link: "A video, carousel, article or campaign, shown live",
};

export const KIND_LABEL: Record<MarketerKind, string> = { video: "Video", carousel: "Carousel", article: "Article", campaign: "Campaign" };
export const VIEW_LABEL: Record<ViewType, string> = { grid: "Grid", board: "Board", calendar: "Calendar", gallery: "Gallery" };

export const OPS_BY_TYPE: Record<FieldType, { op: string; label: string }[]> = (() => {
  const empty = [
    { op: "empty", label: "is empty" },
    { op: "not_empty", label: "is not empty" },
  ];
  const text = [{ op: "contains", label: "contains" }, { op: "not_contains", label: "doesn't contain" }, { op: "is", label: "is" }, { op: "is_not", label: "is not" }, ...empty];
  return {
    text,
    long_text: text,
    url: text,
    number: [{ op: "eq", label: "=" }, { op: "neq", label: "≠" }, { op: "gt", label: ">" }, { op: "gte", label: "≥" }, { op: "lt", label: "<" }, { op: "lte", label: "≤" }, ...empty],
    date: [{ op: "is", label: "is" }, { op: "before", label: "is before" }, { op: "after", label: "is after" }, { op: "on_or_before", label: "is on or before" }, { op: "on_or_after", label: "is on or after" }, ...empty],
    checkbox: [{ op: "is", label: "is" }],
    single_select: [{ op: "is", label: "is" }, { op: "is_not", label: "is not" }, ...empty],
    multi_select: [{ op: "has", label: "has" }, { op: "has_not", label: "doesn't have" }, ...empty],
    person: [{ op: "is", label: "is" }, { op: "is_not", label: "is not" }, ...empty],
    link_row: [...empty],
    marketer_link: [...empty],
  };
})();

export const needsValue = (op: string) => op !== "empty" && op !== "not_empty";

/** Filters ready to send: a filter still waiting for its value is left out instead of being refused. */
export function completeFilters(filters: TrackerFilter[]): TrackerFilter[] {
  return filters.filter((f) => !needsValue(f.op) || (f.value !== "" && f.value !== null && f.value !== undefined && !(typeof f.value === "number" && !Number.isFinite(f.value))));
}

// ------------------------------------------------------------------ values

export function choiceOf(field: TrackerField, id: unknown): Choice | undefined {
  return typeof id === "string" ? field.options.choices?.find((c) => c.id === id) : undefined;
}

export function formatNumber(field: TrackerField, value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const d = field.options.decimals ?? 0;
  const n = value.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${field.options.prefix ?? ""}${n}${field.options.suffix ?? ""}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Dec 1, 2026" or "Dec 1, 2026 10:30". Dates are calendar days: no time zone shift. */
export function formatDate(value: unknown, withTime = false): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return "";
  const [y, m, d] = value.slice(0, 10).split("-").map(Number) as [number, number, number];
  const day = `${MONTHS[m - 1]} ${d}, ${y}`;
  return withTime && value.length >= 16 ? `${day} ${value.slice(11, 16)}` : day;
}

/** Plain text for a cell: search, copy, the gallery's subtitle, screen readers. */
export function cellText(field: TrackerField, value: CellValue, ctx: { resolved?: Resolved; members?: Member[] } = {}): string {
  if (value === null || value === undefined || value === "") return "";
  switch (field.type) {
    case "number":
      return formatNumber(field, value);
    case "date":
      return formatDate(value, field.options.include_time);
    case "checkbox":
      return value ? "Yes" : "No";
    case "single_select":
      return choiceOf(field, value)?.label ?? "";
    case "multi_select":
      return (Array.isArray(value) ? value : []).map((id) => choiceOf(field, id)?.label).filter(Boolean).join(", ");
    case "person":
      return ctx.members?.find((m) => m.id === value)?.name ?? "";
    case "link_row":
      return (Array.isArray(value) ? value : []).map((id) => ctx.resolved?.rows[id] ?? "").filter(Boolean).join(", ");
    case "marketer_link": {
      const o = ctx.resolved?.objects[`${field.options.kind}:${value}`];
      return o?.title ?? "";
    }
    default:
      return String(value);
  }
}

export function primaryField(table: { fields: TrackerField[] }): TrackerField | undefined {
  return table.fields.find((f) => f.is_primary) ?? table.fields[0];
}

export function rowTitle(table: { fields: TrackerField[] }, row: TrackerRow): string {
  const p = primaryField(table);
  const v = p ? row.values[p.id] : null;
  return typeof v === "string" && v.trim() ? v : "Untitled";
}

/** Fields a view shows, in order, without hidden ones (the primary field always shows, first). */
export function visibleFields(table: { fields: TrackerField[] }, view: Pick<TrackerView, "hidden_fields" | "config"> | null): TrackerField[] {
  const hidden = new Set(view?.hidden_fields ?? []);
  const order = view?.config.field_order ?? [];
  const rank = (f: TrackerField) => (f.is_primary ? -1 : order.includes(f.id) ? order.indexOf(f.id) : 1000 + f.position);
  return [...table.fields].filter((f) => f.is_primary || !hidden.has(f.id)).sort((a, b) => rank(a) - rank(b));
}

// ------------------------------------------------------------------ board and calendar

export interface BoardColumn {
  id: string | null; // null: no value
  label: string;
  color: string;
  rows: TrackerRow[];
}

/** Columns of a board: one per option (in option order) or member, then "No value" when any row has none. */
export function boardColumns(field: TrackerField, rows: TrackerRow[], members: Member[] = []): BoardColumn[] {
  const keys: { id: string; label: string; color: string }[] =
    field.type === "person" ? members.map((m) => ({ id: m.id, label: m.name, color: "gray" })) : (field.options.choices ?? []).map((c) => ({ id: c.id, label: c.label, color: c.color }));
  const by = new Map<string | null, TrackerRow[]>(keys.map((k) => [k.id, []]));
  by.set(null, []);
  for (const r of rows) {
    const v = r.values[field.id];
    const key = typeof v === "string" && by.has(v) ? v : null;
    by.get(key)!.push(r);
  }
  const cols: BoardColumn[] = keys.map((k) => ({ ...k, rows: by.get(k.id)! }));
  const none = by.get(null)!;
  return [{ id: null, label: `No ${field.name.toLowerCase()}`, color: "gray", rows: none }, ...cols].filter((c, i) => i > 0 || c.rows.length > 0);
}

/** The 6×7 days of a month grid starting on Monday, as YYYY-MM-DD. */
export function monthGrid(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const start = Date.UTC(year, month, 1 - offset);
  return Array.from({ length: 42 }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
}

export function rowsByDay(field: TrackerField, rows: TrackerRow[]): Map<string, TrackerRow[]> {
  const out = new Map<string, TrackerRow[]>();
  for (const r of rows) {
    const v = r.values[field.id];
    if (typeof v !== "string" || v.length < 10) continue;
    const day = v.slice(0, 10);
    out.set(day, [...(out.get(day) ?? []), r]);
  }
  return out;
}

/** Keep the time of day when a dated row moves to another day. */
export function moveToDay(field: TrackerField, current: CellValue, day: string): string {
  if (field.options.include_time) {
    const time = typeof current === "string" && current.length >= 16 ? current.slice(11, 16) : "09:00";
    return `${day}T${time}`;
  }
  return day;
}

/** Client-side filter, for the preview and for instant feedback while a request is in flight. */
export function matchesFilter(field: TrackerField, f: TrackerFilter, value: CellValue): boolean {
  const isEmpty = value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0) || (field.type === "checkbox" && !value);
  if (f.op === "empty") return isEmpty;
  if (f.op === "not_empty") return !isEmpty;
  const s = typeof value === "string" ? value.toLowerCase() : "";
  const want = typeof f.value === "string" ? f.value.toLowerCase() : f.value;
  switch (field.type) {
    case "text":
    case "long_text":
    case "url":
      if (f.op === "contains") return s.includes(String(want));
      if (f.op === "not_contains") return !s.includes(String(want));
      if (f.op === "is") return s === want;
      return s !== want;
    case "number": {
      if (typeof value !== "number") return f.op === "neq";
      const n = Number(f.value);
      return { eq: value === n, neq: value !== n, gt: value > n, gte: value >= n, lt: value < n, lte: value <= n }[f.op as "eq"] ?? false;
    }
    case "date": {
      if (typeof value !== "string") return false;
      const d = value.slice(0, 10);
      const w = String(f.value);
      return { is: d === w, before: d < w, after: d > w, on_or_before: d <= w, on_or_after: d >= w }[f.op as "is"] ?? false;
    }
    case "checkbox":
      return Boolean(value) === Boolean(f.value);
    case "single_select":
    case "person":
      return f.op === "is" ? value === f.value : value !== f.value;
    case "multi_select":
      return f.op === "has" ? Array.isArray(value) && value.includes(String(f.value)) : !(Array.isArray(value) && value.includes(String(f.value)));
    default:
      return true;
  }
}

/** Short relative-free description of a filter: "Status is Live". */
export function describeFilter(fields: TrackerField[], f: TrackerFilter, members: Member[] = []): string {
  const field = fields.find((x) => x.id === f.field_id);
  if (!field) return "";
  const op = OPS_BY_TYPE[field.type].find((o) => o.op === f.op)?.label ?? f.op;
  if (!needsValue(f.op)) return `${field.name} ${op}`;
  const v = field.type === "single_select" || field.type === "multi_select" ? choiceOf(field, f.value)?.label : field.type === "person" ? members.find((m) => m.id === f.value)?.name : field.type === "checkbox" ? (f.value ? "checked" : "unchecked") : String(f.value ?? "");
  return `${field.name} ${op} ${v ?? ""}`.trim();
}
