"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, ConfirmModal, Field, FieldGroup, IconButton, Input, MenuButton, MenuItem, Notice, Select, Sheet, Switch, TAG_TONES, Tag, TagDot, cx, usePending } from "@/design-system";
import { type Choice, FIELD_TYPE_HINT, FIELD_TYPE_LABEL, type FieldOptions, type FieldType, KIND_LABEL, type MarketerKind, type TrackerField } from "@/lib/tracker";
import { trackerApi } from "@/lib/tracker-client";
import { FIELD_ICON } from "./cells";
import { useTracker } from "./context";

const TYPES: FieldType[] = ["text", "long_text", "number", "single_select", "multi_select", "date", "checkbox", "url", "person", "link_row", "marketer_link"];
const newChoiceId = () => Math.random().toString(16).slice(2, 10);

function ChoicesEditor({ choices, onChange }: { choices: Choice[]; onChange: (c: Choice[]) => void }) {
  return (
    <FieldGroup label="Options" hint="People pick from these. Colours are only for telling them apart.">
      <ul className="space-y-1.5">
        {choices.map((c, i) => (
          <li key={c.id} className="flex items-center gap-1.5">
            <MenuButton
              label={`Colour of ${c.label || "option"}`}
              trigger={() => (
                <button type="button" aria-label={`Colour: ${c.color}`} className="flex size-8 shrink-0 items-center justify-center rounded-ds-md border border-hairline bg-surface-2 hover:border-hairline-strong">
                  <TagDot tone={c.color} />
                </button>
              )}
            >
              {(close) =>
                TAG_TONES.map((t) => (
                  <MenuItem key={t} selected={c.color === t} icon={<TagDot tone={t} />} onClick={() => (close(), onChange(choices.map((x, j) => (j === i ? { ...x, color: t } : x))))}>
                    {t[0]!.toUpperCase() + t.slice(1)}
                  </MenuItem>
                ))
              }
            </MenuButton>
            <Input aria-label={`Option ${i + 1}`} value={c.label} maxLength={60} placeholder="Option" onChange={(e) => onChange(choices.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <IconButton label={`Remove ${c.label || "option"}`} onClick={() => onChange(choices.filter((_, j) => j !== i))}>
              <X />
            </IconButton>
          </li>
        ))}
      </ul>
      <Button variant="ghost" size="sm" onClick={() => onChange([...choices, { id: newChoiceId(), label: "", color: TAG_TONES[choices.length % TAG_TONES.length]! }])}>
        <Plus /> Add an option
      </Button>
      {choices.some((c) => c.label.trim()) && (
        <div className="flex flex-wrap gap-1 pt-1">
          {choices.filter((c) => c.label.trim()).map((c) => (
            <Tag key={c.id} tone={c.color}>
              {c.label}
            </Tag>
          ))}
        </div>
      )}
    </FieldGroup>
  );
}

/** Add a field, or change one, in a small sheet beside the table. */
export function FieldSheet({ open, fieldId, onClose, onSaved, preview }: { open: boolean; fieldId: string | null; onClose: () => void; onSaved: (f: TrackerField, removed?: boolean) => void; preview: boolean }) {
  const { table, tables } = useTracker();
  const existing = fieldId ? table.fields.find((f) => f.id === fieldId) : undefined;
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [options, setOptions] = useState<FieldOptions>({});
  const [confirm, setConfirm] = useState(false);
  const { busy, error, run, setError } = usePending<"save" | "delete">();

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(existing?.name ?? "");
    setType(existing?.type ?? "text");
    setOptions(existing?.options ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fieldId]);

  const pickType = (t: FieldType) => {
    setType(t);
    if (t === "single_select" || t === "multi_select") setOptions((o) => ({ choices: o.choices?.length ? o.choices : [{ id: newChoiceId(), label: "", color: "blue" }] }));
    else if (t === "link_row") setOptions({ table_id: table.id });
    else if (t === "marketer_link") setOptions({ kind: "campaign" });
    else if (t === "number") setOptions({ decimals: 0 });
    else setOptions({});
    if (!name.trim()) setName(FIELD_TYPE_LABEL[t] === "Link to a row" ? "Related" : t === "marketer_link" ? "Campaign" : FIELD_TYPE_LABEL[t]);
  };

  const clean = (): FieldOptions => (options.choices ? { ...options, choices: options.choices.filter((c) => c.label.trim()).map((c) => ({ ...c, label: c.label.trim() })) } : options);

  const save = () =>
    run("save", async () => {
      if (!name.trim()) throw new Error("Give the field a name.");
      const body = { name: name.trim(), type, options: clean() };
      let saved: TrackerField;
      if (preview) saved = { id: existing?.id ?? crypto.randomUUID(), table_id: table.id, position: existing?.position ?? table.fields.length, is_primary: existing?.is_primary ?? false, ...body };
      else saved = existing ? await trackerApi.updateField(table.id, existing.id, { name: body.name, options: body.options }) : await trackerApi.createField(table.id, body);
      onSaved(saved);
    });

  const remove = () =>
    run("delete", async () => {
      if (!existing) return;
      if (!preview) await trackerApi.deleteField(table.id, existing.id);
      setConfirm(false);
      onSaved(existing, true);
    });

  return (
    <>
      <Sheet
        open={open}
        onClose={() => !busy && onClose()}
        title={existing ? `Edit “${existing.name}”` : "Add a field"}
        description={existing ? FIELD_TYPE_LABEL[existing.type] : "A column in every view of this table."}
        width="sm"
        footer={
          <>
            {existing && !existing.is_primary && (
              <Button variant="ghost" className="mr-auto text-negative" onClick={() => setConfirm(true)} disabled={!!busy}>
                Delete field
              </Button>
            )}
            <Button variant="ghost" onClick={onClose} disabled={!!busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void save()} loading={busy === "save"}>
              {existing ? "Save" : "Add field"}
            </Button>
          </>
        }
      >
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="Name">
            <Input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Owner, Publish date, Budget" />
          </Field>
          {!existing && (
            <FieldGroup label="Type">
              <div role="radiogroup" aria-label="Type" className="grid grid-cols-1 gap-1">
                {TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={type === t}
                    onClick={() => pickType(t)}
                    className={cx(
                      "ds-press flex items-center gap-2.5 rounded-ds-md border px-2.5 py-2 text-left [&_svg]:size-4 [&_svg]:shrink-0",
                      type === t ? "border-ds-accent bg-surface-2 [&_svg]:text-ds-accent" : "border-transparent hover:bg-surface-2 [&_svg]:text-fg-muted",
                    )}
                  >
                    {FIELD_ICON[t]}
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{FIELD_TYPE_LABEL[t]}</span>
                      <span className="block text-[12px] text-fg-muted">{FIELD_TYPE_HINT[t]}</span>
                    </span>
                  </button>
                ))}
              </div>
            </FieldGroup>
          )}
          {(type === "single_select" || type === "multi_select") && <ChoicesEditor choices={options.choices ?? []} onChange={(choices) => setOptions({ ...options, choices })} />}
          {type === "number" && (
            <div className="grid grid-cols-3 gap-2">
              <Field label="Decimals">
                <Select value={String(options.decimals ?? 0)} onChange={(e) => setOptions({ ...options, decimals: Number(e.target.value) })}>
                  {[0, 1, 2, 3, 4].map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Before">
                <Input value={options.prefix ?? ""} maxLength={4} placeholder="$" onChange={(e) => setOptions({ ...options, prefix: e.target.value })} />
              </Field>
              <Field label="After">
                <Input value={options.suffix ?? ""} maxLength={4} placeholder="%" onChange={(e) => setOptions({ ...options, suffix: e.target.value })} />
              </Field>
            </div>
          )}
          {type === "date" && (
            <div className="flex items-center justify-between rounded-ds-md border border-hairline bg-surface-2 px-3 py-2.5">
              <span className="text-[13px]">Include a time</span>
              <Switch label="Include a time" checked={!!options.include_time} onChange={(v) => setOptions({ ...options, include_time: v })} />
            </div>
          )}
          {type === "link_row" && (
            <Field label="Links to" hint={existing ? "A link keeps its table." : "Rows of this table or another one in the workspace."}>
              <Select value={options.table_id ?? table.id} disabled={!!existing} onChange={(e) => setOptions({ table_id: e.target.value })}>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id === table.id ? `${t.name} (this table)` : t.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {type === "marketer_link" && (
            <Field label="Marketer item" hint="Its status and numbers show live in the table.">
              <Select value={options.kind ?? "campaign"} disabled={!!existing} onChange={(e) => setOptions({ kind: e.target.value as MarketerKind })}>
                {(Object.keys(KIND_LABEL) as MarketerKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {error && <Notice error={error} />}
          <button type="submit" hidden />
        </form>
      </Sheet>
      <ConfirmModal open={confirm} onClose={() => setConfirm(false)} title={`Delete “${existing?.name ?? ""}”?`} confirmLabel="Delete field" danger busy={busy === "delete"} onConfirm={() => void remove()} error={error}>
        Its values in every row go with it, and views stop filtering or sorting by it.
      </ConfirmModal>
    </>
  );
}
