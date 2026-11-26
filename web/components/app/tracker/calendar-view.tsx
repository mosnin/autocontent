"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, IconButton, TagDot, cx } from "@/design-system";
import { type TrackerRow, type TrackerView, choiceOf, monthGrid, moveToDay, rowTitle, rowsByDay } from "@/lib/tracker";
import { useTracker } from "./context";
import type { RowOps, ViewSettings } from "./table-view";

const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_PER_DAY = 3;

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Calendar: rows placed on their date. Drag a row to another day to
 * reschedule it (the time of day is kept). Click a day's + to add a row there.
 */
export function CalendarView({ rows, view, settings, ops }: { rows: TrackerRow[]; view: TrackerView; settings: ViewSettings; ops: RowOps }) {
  const { table, canEdit } = useTracker();
  const dateField = table.fields.find((f) => f.id === (settings.config.date_field_id ?? view.config.date_field_id)) ?? table.fields.find((f) => f.type === "date");
  const colour = table.fields.find((f) => f.type === "single_select");
  const now = today();
  const firstDated = useMemo(() => {
    if (!dateField) return null;
    const upcoming = rows.map((r) => r.values[dateField.id]).filter((v): v is string => typeof v === "string").sort();
    return upcoming.find((d) => d.slice(0, 10) >= now) ?? upcoming[upcoming.length - 1] ?? null;
  }, [rows, dateField, now]);
  const anchor = (firstDated ?? now).slice(0, 7);
  const [month, setMonth] = useState({ y: Number(anchor.slice(0, 4)), m: Number(anchor.slice(5, 7)) - 1 });
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!dateField) return <p className="p-4 text-[13px] text-fg-muted">This calendar needs a date field.</p>;

  const days = monthGrid(month.y, month.m);
  const byDay = rowsByDay(dateField, rows);
  const undated = rows.filter((r) => typeof r.values[dateField.id] !== "string").length;
  const shift = (d: number) => setMonth(({ y, m }) => ({ y: m + d < 0 ? y - 1 : m + d > 11 ? y + 1 : y, m: (m + d + 12) % 12 }));
  const monthKey = `${month.y}-${String(month.m + 1).padStart(2, "0")}`;

  const dropOn = (day: string) => {
    const row = rows.find((r) => r.id === dragId);
    setDragId(null);
    setOver(null);
    if (!row) return;
    const cur = row.values[dateField.id] ?? null;
    if (typeof cur === "string" && cur.slice(0, 10) === day) return;
    ops.updateCell(row.id, dateField.id, moveToDay(dateField, cur, day));
    setAnnounce(`${rowTitle(table, row)} moved to ${day}`);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <h2 className="text-[14px] font-medium tabular">
          {MONTH[month.m]} {month.y}
        </h2>
        <div className="ml-1 flex items-center">
          <IconButton label="Previous month" onClick={() => shift(-1)}>
            <ChevronLeft />
          </IconButton>
          <IconButton label="Next month" onClick={() => shift(1)}>
            <ChevronRight />
          </IconButton>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setMonth({ y: Number(now.slice(0, 4)), m: Number(now.slice(5, 7)) - 1 })}>
          Today
        </Button>
        {undated > 0 && <span className="ml-auto text-[12px] text-fg-muted">{undated} without a {dateField.name.toLowerCase()}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        <div role="grid" aria-label={`${MONTH[month.m]} ${month.y}`} className="grid min-w-[700px] grid-cols-7 overflow-clip rounded-ds-lg border border-hairline">
          <div role="row" className="contents">
            {WEEKDAYS.map((d) => (
              <div key={d} role="columnheader" className="sticky top-0 z-10 border-b border-hairline bg-surface px-2 py-1.5 text-[12px] text-fg-faint">
                {d}
              </div>
            ))}
          </div>
          {Array.from({ length: 6 }, (_, w) => (
            <div key={w} role="row" className="contents">
              {days.slice(w * 7, w * 7 + 7).map((day, i) => {
                const items = byDay.get(day) ?? [];
                const inMonth = day.startsWith(monthKey);
                const open = expanded === day;
                const shown = open ? items : items.slice(0, MAX_PER_DAY);
                return (
                  <div
                    key={day}
                    role="gridcell"
                    aria-label={`${day}, ${items.length} rows`}
                    onDragOver={(e) => dragId && (e.preventDefault(), setOver(day))}
                    onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver((o) => (o === day ? null : o))}
                    onDrop={(e) => (e.preventDefault(), dropOn(day))}
                    className={cx(
                      "group/day relative min-h-[112px] border-b border-hairline p-1.5 transition-colors duration-150",
                      i < 6 && "border-r",
                      !inMonth && "bg-surface-2/50",
                      over === day && "bg-surface-2",
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className={cx("inline-flex size-6 items-center justify-center rounded-full text-[12px] tabular", day === now ? "bg-ds-accent font-medium text-on-fill" : inMonth ? "text-fg-muted" : "text-fg-faint")}>{Number(day.slice(8))}</span>
                      {canEdit && (
                        <button
                          type="button"
                          aria-label={`Add a row on ${day}`}
                          onClick={async () => {
                            const r = await ops.createRow({ [dateField.id]: moveToDay(dateField, null, day) });
                            if (r) ops.openRow(r.id);
                          }}
                          className="flex size-6 items-center justify-center rounded-ds-sm text-fg-faint opacity-0 hover:bg-surface-3 hover:text-fg focus-visible:opacity-100 group-hover/day:opacity-100 [&_svg]:size-3.5"
                        >
                          <Plus />
                        </button>
                      )}
                    </div>
                    <div className="space-y-1">
                      {shown.map((r) => {
                        const c = colour ? choiceOf(colour, r.values[colour.id]) : undefined;
                        return (
                          <button
                            key={r.id}
                            type="button"
                            draggable={canEdit}
                            onDragStart={(e) => (e.dataTransfer.setData("text/plain", r.id), (e.dataTransfer.effectAllowed = "move"), setDragId(r.id))}
                            onDragEnd={() => (setDragId(null), setOver(null))}
                            onClick={() => ops.openRow(r.id)}
                            className={cx("ds-press flex w-full min-w-0 items-center gap-1.5 rounded-ds-sm border border-hairline bg-surface px-1.5 py-1 text-left text-[12.5px] hover:border-hairline-strong", canEdit && "cursor-grab active:cursor-grabbing", dragId === r.id && "opacity-40")}
                          >
                            {c && (<><TagDot tone={c.color} className="!size-2" /><span className="sr-only">{c.label}</span></>)}
                            <span className="truncate">{rowTitle(table, r)}</span>
                            {dateField.options.include_time && typeof r.values[dateField.id] === "string" && <span className="ml-auto shrink-0 text-[11.5px] tabular text-fg-faint">{String(r.values[dateField.id]).slice(11, 16)}</span>}
                          </button>
                        );
                      })}
                      {items.length > MAX_PER_DAY && (
                        <button type="button" onClick={() => setExpanded(open ? null : day)} className="px-1.5 text-[12px] text-fg-muted hover:text-fg">
                          {open ? "Show less" : `${items.length - MAX_PER_DAY} more`}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
