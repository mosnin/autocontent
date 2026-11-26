"use client";

import { Calendar, Check, CheckSquare, Clapperboard, ExternalLink, FileText, Hash, Image as ImageIcon, Link2, List, ListChecks, Megaphone, Search, Square, Type, User, AlignLeft, Waypoints } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { cx, PersonAvatar, Tag, inputClass } from "@/design-system";
import { type CellValue, choiceOf, formatDate, formatNumber, KIND_LABEL, type FieldType, type MarketerKind, type MarketerObject, type TrackerField } from "@/lib/tracker";
import { useTracker } from "./context";

export const FIELD_ICON: Record<FieldType, ReactNode> = {
  text: <Type />,
  long_text: <AlignLeft />,
  number: <Hash />,
  single_select: <List />,
  multi_select: <ListChecks />,
  date: <Calendar />,
  checkbox: <CheckSquare />,
  url: <Link2 />,
  person: <User />,
  link_row: <Waypoints />,
  marketer_link: <Megaphone />,
};

export const KIND_ICON: Record<MarketerKind, ReactNode> = { video: <Clapperboard />, carousel: <ImageIcon />, article: <FileText />, campaign: <Megaphone /> };

const STATUS_TONE: Record<string, string> = {
  done: "text-positive",
  published: "text-positive",
  running: "text-positive",
  failed: "text-negative",
  awaiting_approval: "text-attention",
  paused: "text-attention",
};

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}

function compact(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);
}

/** A linked Marketer item, live: its title, current status and the metric that matters for its kind. */
export function ObjectChip({ obj, kind, compactView }: { obj?: MarketerObject; kind: MarketerKind; compactView?: boolean }) {
  if (!obj) return <span className="text-fg-faint">{KIND_LABEL[kind]} not found</span>;
  const metric = obj.metrics.views !== undefined ? `${compact(Number(obj.metrics.views))} views` : obj.metrics.words ? `${obj.metrics.words} words` : obj.metrics.budget_usd ? `$${Number(obj.metrics.budget_usd).toLocaleString("en-US")}` : null;
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-ds-xs bg-surface-3 px-1.5 py-px text-[12.5px] [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:text-fg-muted">
      {KIND_ICON[kind]}
      <span className="truncate">{obj.title}</span>
      <span className={cx("shrink-0 text-[11.5px]", STATUS_TONE[obj.status] ?? "text-fg-muted")}>{obj.status.replace(/_/g, " ")}</span>
      {!compactView && metric && <span className="shrink-0 text-[11.5px] tabular text-fg-muted">{metric}</span>}
    </span>
  );
}

/** How a cell reads, in the grid, on cards and in the sheet. */
export function CellDisplay({ field, value, wrap }: { field: TrackerField; value: CellValue | undefined; wrap?: boolean }) {
  const { members, resolved } = useTracker();
  if (field.type === "checkbox")
    return value ? <Check aria-label="Checked" className="size-4 text-ds-accent" /> : <Square aria-label="Not checked" className="size-4 text-fg-faint" />;
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return null;
  switch (field.type) {
    case "number":
      return <span className="tabular">{formatNumber(field, value)}</span>;
    case "date":
      return <span className="tabular">{formatDate(value, field.options.include_time)}</span>;
    case "single_select": {
      const c = choiceOf(field, value);
      return c ? <Tag tone={c.color}>{c.label}</Tag> : null;
    }
    case "multi_select":
      return (
        <span className={cx("flex min-w-0 gap-1", wrap ? "flex-wrap" : "overflow-hidden")}>
          {(value as string[]).map((id) => {
            const c = choiceOf(field, id);
            return c ? (
              <Tag key={id} tone={c.color} className="shrink-0">
                {c.label}
              </Tag>
            ) : null;
          })}
        </span>
      );
    case "url":
      return (
        <a href={String(value)} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()} className="truncate text-ds-accent hover:underline">
          {hostOf(String(value))}
        </a>
      );
    case "person": {
      const m = members.find((x) => x.id === value);
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          <PersonAvatar name={m?.name ?? "?"} size={18} />
          <span className="truncate">{m?.name ?? "Former member"}</span>
        </span>
      );
    }
    case "link_row":
      return (
        <span className={cx("flex min-w-0 gap-1", wrap ? "flex-wrap" : "overflow-hidden")}>
          {(value as string[]).map((id) => (
            <span key={id} className="shrink-0 truncate rounded-ds-xs bg-surface-3 px-1.5 text-[12.5px] leading-5">
              {resolved.rows[id] ?? "Untitled"}
            </span>
          ))}
        </span>
      );
    case "marketer_link": {
      const kind = field.options.kind ?? "video";
      return <ObjectChip kind={kind} obj={resolved.objects[`${kind}:${value}`]} compactView={!wrap} />;
    }
    case "long_text":
      return <span className={cx(wrap ? "whitespace-pre-wrap" : "truncate", "text-fg-muted")}>{String(value)}</span>;
    default:
      return <span className="truncate">{String(value)}</span>;
  }
}

// ---------------------------------------------------------------- pickers

interface PickItem {
  id: string;
  label: string;
  render?: ReactNode;
}

/**
 * Pick one or several items with a search box: select options, people, rows
 * of a linked table, Marketer items. ↑/↓ move, Enter picks, Esc closes.
 */
export function Picker({
  items,
  selected,
  multi,
  onPick,
  onClose,
  onSearch,
  label,
  loading,
  emptyText = "Nothing to pick yet",
}: {
  items: PickItem[];
  selected: string[];
  multi?: boolean;
  onPick: (next: string[]) => void;
  onClose: () => void;
  onSearch?: (q: string) => void;
  label: string;
  loading?: boolean;
  emptyText?: string;
}) {
  const [q, setQ] = useState("");
  // Start on the current choice, so Enter alone keeps it and arrows move from it.
  const [active, setActive] = useState(() => Math.max(0, items.findIndex((i) => i.id === selected[0])));
  const shown = useMemo(() => (onSearch ? items : items.filter((i) => i.label.toLowerCase().includes(q.trim().toLowerCase()))), [items, q, onSearch]);
  const listId = useMemo(() => `pick-${Math.random().toString(36).slice(2, 8)}`, []);
  const pick = (id: string) => {
    if (multi) onPick(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    else {
      onPick(selected[0] === id ? [] : [id]);
      onClose();
    }
  };
  return (
    <div
      className="w-[280px] rounded-ds-md border border-hairline bg-overlay shadow-ds-float ds-pop"
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(shown.length - 1, a + 1)));
        else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
        else if (e.key === "Enter") {
          e.preventDefault();
          const it = shown[active];
          if (it) pick(it.id);
        } else if (e.key === "Escape" || e.key === "Tab") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-2 border-b border-hairline px-2.5">
        <Search aria-hidden className="size-3.5 text-fg-faint" />
        <input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
          aria-label={label}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            onSearch?.(e.target.value);
          }}
          placeholder="Search"
          className="h-9 w-full bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-faint"
        />
      </div>
      <div id={listId} role="listbox" aria-label={label} aria-multiselectable={multi || undefined} className="max-h-64 overflow-y-auto p-1">
        {shown.length === 0 && <div className="px-2 py-2 text-[12.5px] text-fg-muted">{loading ? "Loading…" : emptyText}</div>}
        {shown.map((it, i) => {
          const on = selected.includes(it.id);
          return (
            <div
              key={it.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={on}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(it.id)}
              className={cx("flex h-8 cursor-default items-center gap-2 rounded-ds-sm px-2 text-[13px]", i === active && "bg-surface-2")}
            >
              <span className="min-w-0 flex-1 truncate">{it.render ?? it.label}</span>
              {on && <Check aria-hidden className="size-3.5 shrink-0 text-ds-accent" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Items to pick for a choice-like field; loads people, rows or Marketer items as needed. */
export function usePickItems(field: TrackerField, open: boolean): { items: PickItem[]; loading: boolean; onSearch?: (q: string) => void } {
  const { members, searchObjects, linkedRows } = useTracker();
  const [items, setItems] = useState<PickItem[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const kind = field.options.kind ?? "video";
  const load = (q: string) => {
    const n = ++seq.current;
    setLoading(true);
    searchObjects(kind, q)
      .then((objs) => n === seq.current && setItems(objs.map((o) => ({ id: o.id, label: o.title, render: <ObjectChip obj={o} kind={kind} /> }))))
      .catch(() => n === seq.current && setItems([]))
      .finally(() => n === seq.current && setLoading(false));
  };
  useEffect(() => {
    if (!open) return;
    if (field.type === "marketer_link") load("");
    if (field.type === "link_row" && field.options.table_id) {
      setLoading(true);
      linkedRows(field.options.table_id)
        .then((page) => {
          const primary = page.table?.fields.find((f) => f.is_primary);
          setItems(page.rows.map((r) => ({ id: r.id, label: (primary && typeof r.values[primary.id] === "string" ? (r.values[primary.id] as string) : "") || "Untitled" })));
        })
        .catch(() => setItems([]))
        .finally(() => setLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, field.id]);
  if (field.type === "single_select" || field.type === "multi_select")
    return { items: (field.options.choices ?? []).map((c) => ({ id: c.id, label: c.label, render: <Tag tone={c.color}>{c.label}</Tag> })), loading: false };
  if (field.type === "person")
    return {
      items: members.map((m) => ({ id: m.id, label: m.name, render: <span className="flex items-center gap-2"><PersonAvatar name={m.name} size={18} />{m.name}</span> })),
      loading: false,
    };
  if (field.type === "marketer_link") return { items, loading, onSearch: load };
  return { items, loading };
}

export const PICKER_TYPES: FieldType[] = ["single_select", "multi_select", "person", "link_row", "marketer_link"];
export const isMulti = (t: FieldType) => t === "multi_select" || t === "link_row";

export function toPicked(field: TrackerField, value: CellValue | undefined): string[] {
  if (Array.isArray(value)) return value;
  return typeof value === "string" && value ? [value] : [];
}

export function fromPicked(field: TrackerField, ids: string[]): CellValue {
  return isMulti(field.type) ? ids : (ids[0] ?? null);
}

// ---------------------------------------------------------------- text-like editors

export function draftOf(field: TrackerField, value: CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (field.type === "date") return field.options.include_time ? String(value).slice(0, 16) : String(value).slice(0, 10);
  return String(value);
}

export function parseDraft(field: TrackerField, draft: string): CellValue {
  const t = draft.trim();
  if (!t) return null;
  if (field.type === "number") {
    const n = Number(t.replace(/[,\s$%]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return field.type === "long_text" ? draft : t;
}

/** One input or textarea for text, long text, number, link and date. */
export function TextEditor({
  field,
  value,
  initial,
  onCommit,
  onCancel,
  className,
  autoFocus = true,
  inline,
}: {
  field: TrackerField;
  value: CellValue | undefined;
  initial?: string;
  onCommit: (v: CellValue, move?: "down" | "right" | "left" | null) => void;
  onCancel: () => void;
  className?: string;
  autoFocus?: boolean;
  inline?: boolean;
}) {
  const [draft, setDraft] = useState(initial ?? draftOf(field, value));
  const done = useRef(false);
  const commit = (move: "down" | "right" | "left" | null) => {
    if (done.current) return;
    done.current = true;
    onCommit(parseDraft(field, draft), move);
  };
  const common = {
    autoFocus,
    "aria-label": field.name,
    value: draft,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: () => commit(null),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        done.current = true;
        onCancel();
      } else if (e.key === "Enter" && !(field.type === "long_text" && e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
        commit(inline ? "down" : null);
      } else if (e.key === "Tab" && inline) {
        e.preventDefault();
        e.stopPropagation();
        commit(e.shiftKey ? "left" : "right");
      }
    },
  };
  if (field.type === "long_text")
    return <textarea {...common} rows={inline ? 5 : 4} placeholder="Shift+Enter for a new line" className={cx(inputClass, "resize-y", className)} />;
  const type = field.type === "number" ? "text" : field.type === "date" ? (field.options.include_time ? "datetime-local" : "date") : field.type === "url" ? "url" : "text";
  return <input {...common} type={type} inputMode={field.type === "number" ? "decimal" : undefined} className={cx(inputClass, "h-8", className)} />;
}

/** Open the linked item in Marketer (sheet and cards). */
export function OpenObject({ obj }: { obj?: MarketerObject }) {
  if (!obj) return null;
  return (
    <Link href={obj.href} className="inline-flex items-center gap-1 text-[12.5px] text-ds-accent hover:underline">
      Open <ExternalLink aria-hidden className="size-3" />
    </Link>
  );
}
