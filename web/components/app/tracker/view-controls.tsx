"use client";

import { Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button, IconButton, Input, Popover, Segmented, Select, Switch } from "@/design-system";
import { type Member, OPS_BY_TYPE, type TrackerField, type TrackerFilter, type TrackerSort, needsValue } from "@/lib/tracker";

type TriggerProps = { open: boolean; toggle: () => void; "aria-expanded": boolean; "aria-haspopup": "dialog" };

function defaultValue(field: TrackerField): unknown {
  if (field.type === "checkbox") return true;
  if (field.type === "single_select" || field.type === "multi_select") return field.options.choices?.[0]?.id ?? "";
  if (field.type === "date") return new Date().toISOString().slice(0, 10);
  return "";
}

function ValueInput({ field, filter, members, onChange }: { field: TrackerField; filter: TrackerFilter; members: Member[]; onChange: (v: unknown) => void }) {
  if (!needsValue(filter.op)) return null;
  if (field.type === "single_select" || field.type === "multi_select")
    return (
      <Select aria-label="Value" value={String(filter.value ?? "")} onChange={(e) => onChange(e.target.value)}>
        {(field.options.choices ?? []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </Select>
    );
  if (field.type === "person")
    return (
      <Select aria-label="Value" value={String(filter.value ?? "")} onChange={(e) => onChange(e.target.value)}>
        <option value="">Pick someone</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </Select>
    );
  if (field.type === "checkbox")
    return (
      <Select aria-label="Value" value={filter.value ? "true" : "false"} onChange={(e) => onChange(e.target.value === "true")}>
        <option value="true">checked</option>
        <option value="false">not checked</option>
      </Select>
    );
  return (
    <Input
      aria-label="Value"
      type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
      value={String(filter.value ?? "")}
      onChange={(e) => onChange(field.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
      placeholder="Value"
    />
  );
}

/** Filters for the current view: field, condition, value; match all or any. */
export function FilterPanel({
  fields,
  members,
  filters,
  filterType,
  onChange,
  trigger,
}: {
  fields: TrackerField[];
  members: Member[];
  filters: TrackerFilter[];
  filterType: "and" | "or";
  onChange: (filters: TrackerFilter[], filterType: "and" | "or") => void;
  trigger: (p: TriggerProps) => ReactNode;
}) {
  const usable = fields.filter((f) => OPS_BY_TYPE[f.type].length > 0);
  const set = (next: TrackerFilter[], type = filterType) => onChange(next, type);
  return (
    <Popover label="Filter rows" align="right" trigger={trigger}>
      {() => (
        <div className="space-y-3">
          {filters.length === 0 && <p className="text-[12.5px] text-fg-muted">Show only the rows that match. Filters apply to everyone using this view.</p>}
          {filters.length > 1 && (
            <Segmented
              label="Match"
              size="sm"
              value={filterType}
              onChange={(v) => set(filters, v)}
              options={[
                { value: "and", label: "Match all" },
                { value: "or", label: "Match any" },
              ]}
            />
          )}
          {filters.map((f, i) => {
            const field = fields.find((x) => x.id === f.field_id) ?? usable[0]!;
            return (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5 sm:grid-cols-[1fr_1fr_1.2fr_auto]">
                <Select
                  aria-label="Field"
                  value={field.id}
                  onChange={(e) => {
                    const nf = fields.find((x) => x.id === e.target.value)!;
                    const op = OPS_BY_TYPE[nf.type][0]!.op;
                    set(filters.map((x, j) => (j === i ? { field_id: nf.id, op, value: defaultValue(nf) } : x)));
                  }}
                >
                  {usable.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
                <Select aria-label="Condition" value={f.op} onChange={(e) => set(filters.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)))}>
                  {OPS_BY_TYPE[field.type].map((o) => (
                    <option key={o.op} value={o.op}>
                      {o.label}
                    </option>
                  ))}
                </Select>
                <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                  <ValueInput field={field} filter={f} members={members} onChange={(v) => set(filters.map((x, j) => (j === i ? { ...x, value: v } : x)))} />
                </div>
                <IconButton label="Remove filter" onClick={() => set(filters.filter((_, j) => j !== i))}>
                  <X />
                </IconButton>
              </div>
            );
          })}
          <Button
            variant="ghost"
            size="sm"
            disabled={usable.length === 0}
            onClick={() => {
              const f = usable.find((x) => x.type === "single_select") ?? usable[0]!;
              set([...filters, { field_id: f.id, op: OPS_BY_TYPE[f.type][0]!.op, value: defaultValue(f) }]);
            }}
          >
            <Plus /> Add a filter
          </Button>
        </div>
      )}
    </Popover>
  );
}

export function SortPanel({ fields, sorts, onChange, trigger }: { fields: TrackerField[]; sorts: TrackerSort[]; onChange: (s: TrackerSort[]) => void; trigger: (p: TriggerProps) => ReactNode }) {
  const free = fields.filter((f) => !sorts.some((s) => s.field_id === f.id));
  return (
    <Popover label="Sort rows" align="right" trigger={trigger}>
      {() => (
        <div className="space-y-3">
          {sorts.length === 0 && <p className="text-[12.5px] text-fg-muted">Rows keep the order you give them until you sort by a field.</p>}
          {sorts.map((s, i) => (
            <div key={s.field_id} className="grid grid-cols-[1fr_auto_auto] items-center gap-1.5">
              <Select aria-label="Sort by" value={s.field_id} onChange={(e) => onChange(sorts.map((x, j) => (j === i ? { ...x, field_id: e.target.value } : x)))}>
                {fields
                  .filter((f) => f.id === s.field_id || !sorts.some((x) => x.field_id === f.id))
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
              </Select>
              <Segmented
                label="Direction"
                size="sm"
                value={s.direction}
                onChange={(d) => onChange(sorts.map((x, j) => (j === i ? { ...x, direction: d } : x)))}
                options={[
                  { value: "asc", label: "A → Z" },
                  { value: "desc", label: "Z → A" },
                ]}
              />
              <IconButton label="Remove sort" onClick={() => onChange(sorts.filter((_, j) => j !== i))}>
                <X />
              </IconButton>
            </div>
          ))}
          {free.length > 0 && sorts.length < 5 && (
            <Button variant="ghost" size="sm" onClick={() => onChange([...sorts, { field_id: free[0]!.id, direction: "asc" }])}>
              <Plus /> Add a sort
            </Button>
          )}
        </div>
      )}
    </Popover>
  );
}

export function FieldsPanel({ fields, hidden, onChange, trigger }: { fields: TrackerField[]; hidden: string[]; onChange: (h: string[]) => void; trigger: (p: TriggerProps) => ReactNode }) {
  return (
    <Popover label="Fields in this view" align="right" className="w-[280px]" trigger={trigger}>
      {() => (
        <ul className="space-y-0.5">
          {fields.map((f) => (
            <li key={f.id} className="flex h-8 items-center justify-between gap-3 px-1 text-[13px]">
              <span className="truncate">{f.name}</span>
              {f.is_primary ? (
                <span className="text-[12px] text-fg-faint">Always shown</span>
              ) : (
                <Switch label={`Show ${f.name}`} checked={!hidden.includes(f.id)} onChange={(on) => onChange(on ? hidden.filter((h) => h !== f.id) : [...hidden, f.id])} />
              )}
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}
