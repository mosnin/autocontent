"use client";

import * as React from "react";

import { Button } from "@/components/square/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/square/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { allModels } from "@/lib/studio/model-catalog";
import type { StudioGeneration, StudioKind, StudioModel } from "@/lib/studio/client";
import type { ModelDefinition } from "@/lib/studio/types";
import { useStudioModels, useStudioPreference, useStudioRuns } from "@/lib/studio/use-studio";

import { HistoryRail } from "./history-rail";
import { ReferenceInput, type ReferenceItem } from "./reference-input";
import { ResultCanvas } from "./result-canvas";
import { SchemaControls, defaultsFor, type ParamValues } from "./schema-controls";

/** One media input a studio accepts, e.g. the still a video animates from. */
export interface ReferenceSlot {
  /** Payload key the model reads it as. */
  param: "image_url" | "images_list" | "video_url" | "audio_url" | "last_image";
  label: string;
  accept: string;
  /** Upper bound on items; >1 renders the ordered multi-image input. */
  max?: number;
  /** True when no model in this studio runs without it. */
  required?: boolean;
}

export interface StudioSurfaceProps {
  kind: StudioKind;
  title: string;
  blurb: string;
  /** Which payload key the written input is sent as. */
  promptParam?: "prompt" | "text";
  promptLabel?: string;
  promptPlaceholder?: string;
  referenceSlots?: ReferenceSlot[];
  /** Studio-specific follow-ups on a finished result. */
  resultActions?: (generation: StudioGeneration) => React.ReactNode;
  emptyHint?: string;
}

const catalogEntry = (model: StudioModel | undefined): ModelDefinition | undefined =>
  model?.catalog_id
    ? allModels.find((m) => m.id === model.catalog_id)
    : undefined;

export function StudioSurface({
  kind,
  title,
  blurb,
  promptParam = "prompt",
  promptLabel = "Prompt",
  promptPlaceholder = "Describe what you want",
  referenceSlots = [],
  resultActions,
  emptyHint = "Your result appears here.",
}: StudioSurfaceProps) {
  const { models, isLoading: modelsLoading } = useStudioModels(kind);
  const { runs, isLoading, submit, submitting, submitError, remove } =
    useStudioRuns(kind);

  const [prompt, setPrompt] = React.useState("");
  const [refs, setRefs] = React.useState<Record<string, ReferenceItem[]>>({});
  const [values, setValues] = React.useState<ParamValues>({});
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [modelId, setModelId] = useStudioPreference(`${kind}.model`, "");

  // Mode switching: attaching a reference moves the picker onto the models
  // that take one, exactly as leaving it empty keeps it on the ones that
  // don't. The set the picker offers is always the set that can run.
  const attached = React.useMemo(
    () =>
      new Set(
        Object.entries(refs)
          .filter(([, items]) => items.length > 0)
          .map(([param]) => param),
      ),
    [refs],
  );

  const eligible = React.useMemo(() => {
    const needsReference = (m: StudioModel) =>
      m.required_params.some((p) =>
        referenceSlots.some((slot) => slot.param === p),
      );
    if (referenceSlots.length === 0) return models;
    const withRefs = models.filter(needsReference);
    const withoutRefs = models.filter((m) => !needsReference(m));
    if (attached.size > 0) return withRefs.length > 0 ? withRefs : models;
    return withoutRefs.length > 0 ? withoutRefs : models;
  }, [attached, models, referenceSlots]);

  const selected =
    eligible.find((m) => m.id === modelId) ?? eligible[0] ?? undefined;
  const schema = catalogEntry(selected);

  // Switching model resets the controls to that model's own defaults —
  // carrying a previous model's values over would submit options it never
  // declared.
  const schemaId = schema?.id ?? "";
  React.useEffect(() => {
    setValues(defaultsFor(schema, kind));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaId, kind]);

  const [duration, setDuration] = React.useState<number | null>(null);
  React.useEffect(() => {
    setDuration(selected?.default_duration_sec ?? null);
  }, [selected?.id, selected?.default_duration_sec]);

  const shown =
    runs.find((r) => r.id === selectedId) ?? runs[0] ?? null;

  const missingRequired = referenceSlots
    .filter((slot) => slot.required && !(refs[slot.param]?.length))
    .map((slot) => slot.label);
  const promptRequired = promptParam === "text" || referenceSlots.length === 0;
  const canSubmit =
    Boolean(selected) &&
    !submitting &&
    missingRequired.length === 0 &&
    (!promptRequired || prompt.trim().length > 0);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !canSubmit) return;
    const params: Record<string, unknown> = { ...values };
    if (prompt.trim()) params[promptParam] = prompt.trim();
    for (const slot of referenceSlots) {
      const items = refs[slot.param] ?? [];
      if (items.length === 0) continue;
      params[slot.param] =
        slot.param === "images_list"
          ? items.map((i) => i.url)
          : items[0].url;
    }
    if (selected.unit === "second" && duration) params.duration_sec = duration;
    const created = await submit(selected.id, params);
    if (created) setSelectedId(created.id);
  };

  const durations = selected?.allowed_durations ?? [];

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{blurb}</p>
      </header>

      {!modelsLoading && models.length === 0 ? (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          No {title.toLowerCase()} model is available on this account. An
          operator has to configure the provider before this studio can run.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)_240px]">
          <form className="space-y-5" onSubmit={onSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="studio-model">Model</Label>
              <Select
                onValueChange={setModelId}
                value={selected?.id ?? ""}
              >
                <SelectTrigger className="w-full" id="studio-model">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {eligible.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selected ? (
                <p className="text-xs text-muted-foreground">
                  ${Number(selected.usd_per_unit).toFixed(3)} per {selected.unit}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="studio-prompt">{promptLabel}</Label>
              <Textarea
                id="studio-prompt"
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={promptPlaceholder}
                rows={5}
                value={prompt}
              />
            </div>

            {referenceSlots.map((slot) => (
              <ReferenceInput
                accept={slot.accept}
                items={refs[slot.param] ?? []}
                key={slot.param}
                label={slot.label}
                max={slot.max ?? 1}
                onChange={(next) =>
                  setRefs((current) => ({ ...current, [slot.param]: next }))
                }
              />
            ))}

            {selected?.unit === "second" ? (
              <div className="space-y-1.5">
                <Label htmlFor="studio-duration">Duration (seconds)</Label>
                <Select
                  onValueChange={(v) => setDuration(Number(v))}
                  value={duration ? String(duration) : ""}
                >
                  <SelectTrigger className="w-full" id="studio-duration">
                    <SelectValue placeholder="Select a length" />
                  </SelectTrigger>
                  <SelectContent>
                    {(durations.length > 0
                      ? durations
                      : [selected.default_duration_sec]
                    ).map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {d}s
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selected.duration_from_input ? (
                  <p className="text-xs text-muted-foreground">
                    This model runs as long as its input media. Set the input&apos;s
                    length so the cost can be checked against your cap.
                  </p>
                ) : null}
              </div>
            ) : null}

            <SchemaControls
              kind={kind}
              model={schema}
              onChange={(key, value) =>
                setValues((current) => ({ ...current, [key]: value }))
              }
              values={values}
            />

            <Button className="w-full" disabled={!canSubmit} type="submit">
              {submitting ? "Submitting…" : "Generate"}
            </Button>

            {missingRequired.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Add {missingRequired.join(" and ")} to generate.
              </p>
            ) : null}
            {submitError ? (
              <p className="text-sm text-destructive">{submitError}</p>
            ) : null}
          </form>

          <ResultCanvas
            actions={resultActions}
            emptyHint={emptyHint}
            generation={shown}
          />

          <HistoryRail
            isLoading={isLoading}
            onRemove={(id) => void remove(id)}
            onSelect={(g) => setSelectedId(g.id)}
            runs={runs}
            selectedId={shown?.id ?? null}
          />
        </div>
      )}
    </div>
  );
}
