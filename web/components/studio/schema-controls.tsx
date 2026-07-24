"use client";

import * as React from "react";

import { Input } from "@/components/square/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/square/ui/select";
import { Label } from "@/components/ui/label";
import type { StudioKind } from "@/lib/studio/client";
import type { ModelDefinition, ModelInputField } from "@/lib/studio/types";

import { HANDLED_ELSEWHERE, accepts } from "./params";

export type ParamValues = Record<string, unknown>;

/** A field's payload key: the schema's own `name` when it carries one. */
const keyOf = (name: string, field: ModelInputField) =>
  typeof field.name === "string" && field.name ? field.name : name;

const titleOf = (name: string, field: ModelInputField) =>
  typeof field.title === "string" && field.title
    ? field.title
    : name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const isNumeric = (field: ModelInputField) =>
  field.type === "int" ||
  field.type === "integer" ||
  field.type === "float" ||
  field.type === "number";

/**
 * Which fields of a model's schema become controls: the ones this kind's
 * endpoint accepts, minus the ones with dedicated UI (prompt box, uploader).
 * Order follows the schema so a model's own grouping is preserved.
 */
export function controlFields(
  model: ModelDefinition | undefined,
  kind: StudioKind,
): [string, ModelInputField][] {
  if (!model?.inputs) return [];
  return Object.entries(model.inputs).filter(([name, field]) => {
    const key = keyOf(name, field);
    if (HANDLED_ELSEWHERE.has(key)) return false;
    if (field.type === "file") return false;
    return accepts(kind, key);
  });
}

/** The schema's defaults for a model — what a fresh submit starts from. */
export function defaultsFor(
  model: ModelDefinition | undefined,
  kind: StudioKind,
): ParamValues {
  const out: ParamValues = {};
  for (const [name, field] of controlFields(model, kind)) {
    if (field.default === undefined || field.default === null) continue;
    out[keyOf(name, field)] = field.default;
  }
  return out;
}

/**
 * Every control on a studio's rail, derived from the selected model's own
 * `inputs` schema. Nothing here is hardcoded per model: switch the model and
 * the controls, their options, and their defaults all change with it.
 */
export function SchemaControls({
  model,
  kind,
  values,
  onChange,
  disabled,
}: {
  model: ModelDefinition | undefined;
  kind: StudioKind;
  values: ParamValues;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
}) {
  const fields = controlFields(model, kind);
  if (fields.length === 0) return null;

  return (
    <div className="space-y-4">
      {fields.map(([name, field]) => {
        const key = keyOf(name, field);
        const id = `param-${key}`;
        const label = titleOf(name, field);
        const value = values[key];

        if (Array.isArray(field.enum) && field.enum.length > 0) {
          return (
            <div className="space-y-1.5" key={key}>
              <Label htmlFor={id}>{label}</Label>
              <Select
                disabled={disabled}
                onValueChange={(next) => {
                  const match = field.enum?.find((o) => String(o) === next);
                  onChange(key, match ?? next);
                }}
                value={value === undefined ? undefined : String(value)}
              >
                <SelectTrigger className="w-full" id={id}>
                  <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
                </SelectTrigger>
                <SelectContent>
                  {field.enum.map((option) => (
                    <SelectItem key={String(option)} value={String(option)}>
                      {String(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {field.description ? (
                <p className="text-xs text-muted-foreground">{field.description}</p>
              ) : null}
            </div>
          );
        }

        if (field.type === "boolean") {
          return (
            <label
              className="flex items-center gap-2 text-sm"
              htmlFor={id}
              key={key}
            >
              <input
                checked={Boolean(value)}
                className="size-4 rounded border-input accent-foreground"
                disabled={disabled}
                id={id}
                onChange={(e) => onChange(key, e.target.checked)}
                type="checkbox"
              />
              {label}
            </label>
          );
        }

        if (isNumeric(field)) {
          const min = field.minValue ?? field.minimum;
          const max = field.maxValue ?? field.maximum;
          return (
            <div className="space-y-1.5" key={key}>
              <Label htmlFor={id}>{label}</Label>
              <Input
                disabled={disabled}
                id={id}
                max={max}
                min={min}
                onChange={(e) =>
                  onChange(
                    key,
                    e.target.value === "" ? undefined : Number(e.target.value),
                  )
                }
                step={field.step ?? (field.type === "float" ? 0.1 : 1)}
                type="number"
                value={value === undefined || value === null ? "" : String(value)}
              />
              {field.description ? (
                <p className="text-xs text-muted-foreground">{field.description}</p>
              ) : null}
            </div>
          );
        }

        return (
          <div className="space-y-1.5" key={key}>
            <Label htmlFor={id}>{label}</Label>
            <Input
              disabled={disabled}
              id={id}
              onChange={(e) => onChange(key, e.target.value || undefined)}
              placeholder={
                typeof field.placeholder === "string" ? field.placeholder : undefined
              }
              value={value === undefined || value === null ? "" : String(value)}
            />
            {field.description ? (
              <p className="text-xs text-muted-foreground">{field.description}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
