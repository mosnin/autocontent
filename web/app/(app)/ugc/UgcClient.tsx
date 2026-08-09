"use client";

// UGC studio composer + render shelf.
//
// The composer is *catalog-driven*: `GET /api/v1/ugc/models` is the only
// source of truth for which aspect ratios, durations, resolutions and content
// modes a model accepts, and `src/marketer/ugc/catalog.validate_params` 400s
// anything else before a cent is spent. So every control here is rendered
// from the selected model's declared capability — a duration renders as a
// slider or a fixed option set depending on `duration.kind`, and resolution /
// mode disappear entirely for models that have no such knob (passing one is a
// hard error, not a dropped field). Switching models re-clamps the current
// selection through `clampParams` and says out loud what it changed, so the
// form can never hold a combination the backend would reject.

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { clientFetch } from "@/lib/client-fetcher";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Niche } from "@/lib/types";
import {
  clampParams,
  createRender,
  danglingImageRefs,
  defaultParams,
  deleteRender,
  estimateCostUsd,
  isUgcTerminal,
  retryRender,
  ugcKeys,
  usdPerSecond,
  type UgcModel,
  type UgcModelCatalog,
  type UgcParams,
  type UgcRender,
  type UgcStatus,
} from "@/lib/ugc-client";

const POLL_MS = 8_000;

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${Math.max(sec, 0)}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function StatusBadge({ status }: { status: UgcStatus }) {
  if (status === "done") {
    return (
      <Badge className="font-mono" variant="secondary">
        Done
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge className="font-mono" variant="destructive">
        Failed
      </Badge>
    );
  }
  return (
    <Badge className="gap-1.5 font-mono" variant="outline">
      <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-primary" />
      {status === "queued" ? "Queued" : "Rendering"}
    </Badge>
  );
}

/** A closed capability set, rendered as pressable chips. */
function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  format,
  disabled,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  format?: (v: T) => string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          aria-pressed={opt === value}
          className={cn(
            "rounded-md border px-2.5 py-1 font-mono text-xs transition-colors",
            "disabled:pointer-events-none disabled:opacity-50",
            opt === value
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
          disabled={disabled}
          key={String(opt)}
          onClick={() => onChange(opt)}
          type="button"
        >
          {format ? format(opt) : String(opt)}
        </button>
      ))}
    </div>
  );
}

function Control({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium">{label}</span>
        {hint ? (
          <span className="text-right text-[11px] text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function NotConfigured({ reason }: { reason: string | null }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <h3 className="text-lg font-semibold">UGC studio isn&apos;t switched on</h3>
        <p className="max-w-md text-sm text-muted-foreground">
          {reason ??
            "The render provider isn't reachable from this deployment right now."}
        </p>
        <p className="max-w-md text-xs text-muted-foreground">
          Nothing is broken and nothing was lost — the studio needs{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono">
            MARKETER_UGC_ENABLED
          </code>{" "}
          and{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono">
            MARKETER_MUAPI_API_KEY
          </code>{" "}
          set before it will accept work.
        </p>
      </CardContent>
    </Card>
  );
}

export function UgcClient({
  initialCatalog,
  initialRenders,
  niches,
  notConfigured,
}: {
  initialCatalog: UgcModelCatalog | null;
  initialRenders: UgcRender[];
  niches: Niche[];
  notConfigured: string | null;
}) {
  const configured = initialCatalog !== null;

  // The catalog is static per deployment, so it is fetched once and never
  // polled; the render shelf polls only while something is in flight.
  const { data: catalog } = useSWR<UgcModelCatalog>(
    configured ? ugcKeys.models() : null,
    clientFetch,
    { fallbackData: initialCatalog ?? undefined, revalidateOnFocus: false },
  );

  // Poll only while something is still in flight. `pollMs` is a stable number
  // so SWR's interval effect re-runs exactly when the answer flips — it goes
  // to 0 (off) once every render is terminal, and back on when a new one is
  // queued. A permanent poll on a finished page is pure waste.
  const [pollMs, setPollMs] = React.useState(() =>
    initialRenders.some((r) => !isUgcTerminal(r)) ? POLL_MS : 0,
  );
  const { data: renderData, mutate } = useSWR<UgcRender[]>(
    configured ? ugcKeys.renders() : null,
    clientFetch,
    { fallbackData: initialRenders, refreshInterval: pollMs },
  );
  const renders = React.useMemo(() => renderData ?? [], [renderData]);
  const anyPending = renders.some((r) => !isUgcTerminal(r));
  React.useEffect(() => {
    setPollMs(anyPending ? POLL_MS : 0);
  }, [anyPending]);

  const models = catalog?.models ?? [];
  const maxImages = catalog?.max_reference_images ?? 7;

  const [modelId, setModelId] = React.useState<string>(models[0]?.id ?? "");
  const model: UgcModel | undefined =
    models.find((m) => m.id === modelId) ?? models[0];

  const [params, setParams] = React.useState<UgcParams>(() =>
    models[0] ? defaultParams(models[0]) : { aspect_ratio: "", duration: 0, resolution: "", mode: "" },
  );
  const [adjustments, setAdjustments] = React.useState<string[]>([]);

  const [prompt, setPrompt] = React.useState("");
  const [images, setImages] = React.useState<string[]>([]);
  const [nicheId, setNicheId] = React.useState<string>("none");
  const [busy, setBusy] = React.useState(false);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);

  const urls = images.map((u) => u.trim()).filter(Boolean);
  const dangling = danglingImageRefs(prompt, urls.length);

  /** Switching models: preserve intent where the new model supports it,
   *  correct it where it doesn't, and say which is which. */
  function selectModel(id: string) {
    const next = models.find((m) => m.id === id);
    if (!next) return;
    const clamped = clampParams(next, params);
    const notes: string[] = [];
    if (model && clamped.aspect_ratio !== params.aspect_ratio) {
      notes.push(`aspect ${params.aspect_ratio} → ${clamped.aspect_ratio}`);
    }
    if (model && clamped.duration !== params.duration) {
      notes.push(`duration ${params.duration}s → ${clamped.duration}s`);
    }
    if (model && clamped.resolution !== params.resolution) {
      notes.push(
        clamped.resolution
          ? `resolution ${params.resolution || "—"} → ${clamped.resolution}`
          : `resolution dropped (${next.name} has no resolution control)`,
      );
    }
    if (model && clamped.mode !== params.mode) {
      notes.push(
        clamped.mode
          ? `mode ${params.mode || "—"} → ${clamped.mode}`
          : `content mode dropped (${next.name} has none)`,
      );
    }
    setModelId(id);
    setParams(clamped);
    setAdjustments(notes);
  }

  function set<K extends keyof UgcParams>(key: K, value: UgcParams[K]) {
    setAdjustments([]);
    setParams((p) => ({ ...p, [key]: value }));
  }

  function appendToken(n: number) {
    setPrompt((p) => (p.trimEnd() ? `${p.trimEnd()} @image${n} ` : `@image${n} `));
  }

  const rate = model ? usdPerSecond(model, params.resolution) : null;
  const estimate = model ? estimateCostUsd(model, params) : null;

  const promptRequired = urls.length === 0;
  const canSubmit =
    !!model &&
    !busy &&
    dangling.length === 0 &&
    (!promptRequired || prompt.trim().length > 0);

  async function submit() {
    if (!model) return;
    setBusy(true);
    try {
      await createRender({
        model_id: model.id,
        prompt: prompt.trim(),
        aspect_ratio: params.aspect_ratio,
        duration: params.duration,
        // "" is not the same as absent: a model with no resolution/mode knob
        // 400s on a non-empty value, so send null instead.
        resolution: params.resolution || null,
        mode: params.mode || null,
        image_urls: urls,
        niche_id: nicheId === "none" ? null : nicheId,
      });
      toast.success("Render queued");
      setPrompt("");
      setImages([]);
      void mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not queue the render");
    } finally {
      setBusy(false);
    }
  }

  async function onRetry(id: string) {
    setRowBusy(id);
    try {
      await retryRender(id);
      toast.success("Retrying");
      void mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setRowBusy(null);
    }
  }

  async function onDelete(id: string) {
    setRowBusy(id);
    try {
      await deleteRender(id);
      toast.success("Render deleted");
      void mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setRowBusy(null);
    }
  }

  const header = (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">UGC studio</h1>
      <p className="text-sm text-muted-foreground">
        A script plus up to {maxImages} reference images becomes one vertical
        spokesperson ad. Every control below comes from the selected model&apos;s
        own capability list.
      </p>
    </div>
  );

  if (!configured || !catalog) {
    return (
      <div className="space-y-6">
        {header}
        <NotConfigured reason={notConfigured} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <div className="grid gap-6 lg:grid-cols-5">
        {/* ------------------------------------------------ composer */}
        <Card className="lg:col-span-2 lg:sticky lg:top-4 lg:self-start">
          <CardContent className="space-y-5 py-5">
            <Control label="Model">
              <Select onValueChange={selectModel} value={model?.id ?? ""}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a model" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {m.provider}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {model ? (
                <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
                  {model.description}
                </p>
              ) : null}
            </Control>

            {adjustments.length > 0 && (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">
                  Adjusted for {model?.name}:
                </span>{" "}
                {adjustments.join(" · ")}
              </div>
            )}

            {model && (
              <>
                <Separator />

                <Control
                  label="Aspect ratio"
                  hint={`${model.aspect_ratios.length} supported`}
                >
                  <Segmented
                    onChange={(v) => set("aspect_ratio", v)}
                    options={model.aspect_ratios}
                    value={params.aspect_ratio}
                  />
                </Control>

                <Control
                  label="Duration"
                  hint={
                    model.duration.kind === "range"
                      ? `${model.duration.min}–${model.duration.max}s`
                      : model.duration.options.length === 1
                        ? "fixed by the model"
                        : `${model.duration.options.length} options`
                  }
                >
                  {model.duration.kind === "range" ? (
                    <div className="flex items-center gap-3">
                      <input
                        aria-label="Duration in seconds"
                        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                        max={model.duration.max}
                        min={model.duration.min}
                        onChange={(e) => set("duration", Number(e.target.value))}
                        step={1}
                        type="range"
                        value={params.duration}
                      />
                      <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums">
                        {params.duration}s
                      </span>
                    </div>
                  ) : (
                    <Segmented
                      disabled={model.duration.options.length === 1}
                      format={(v) => `${v}s`}
                      onChange={(v) => set("duration", v)}
                      options={model.duration.options}
                      value={params.duration}
                    />
                  )}
                </Control>

                <Control
                  label="Resolution"
                  hint={model.resolutions.length === 0 ? "not applicable" : undefined}
                >
                  {model.resolutions.length > 0 ? (
                    <Segmented
                      onChange={(v) => set("resolution", v)}
                      options={model.resolutions}
                      value={params.resolution}
                    />
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      {model.name} has no resolution parameter — its output size is
                      fixed by the endpoint.
                    </p>
                  )}
                </Control>

                <Control
                  label="Content mode"
                  hint={model.modes.length === 0 ? "not applicable" : undefined}
                >
                  {model.modes.length > 0 ? (
                    <Segmented
                      onChange={(v) => set("mode", v)}
                      options={model.modes}
                      value={params.mode}
                    />
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      {model.name} has no content-mode parameter.
                    </p>
                  )}
                </Control>

                <Separator />

                <Control
                  label="Script"
                  hint={promptRequired ? "required without images" : "optional"}
                >
                  <Textarea
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="@image1 holds up @image2 and says: this fixed my morning routine"
                    rows={5}
                    value={prompt}
                  />
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Reference an attached image inline as{" "}
                    <code className="rounded bg-muted px-1 font-mono">@image1</code>,{" "}
                    <code className="rounded bg-muted px-1 font-mono">@image2</code>…
                    — 1-based, in upload order. Tap a chip below to insert one.
                  </p>
                  {dangling.length > 0 && (
                    <p className="text-[11px] text-destructive">
                      {dangling.map((n) => `@image${n}`).join(", ")}{" "}
                      {dangling.length === 1 ? "points" : "point"} at an image you
                      haven&apos;t attached — the render would be missing it.
                    </p>
                  )}
                </Control>

                <Control
                  label="Reference images"
                  hint={`${urls.length}/${maxImages}`}
                >
                  <div className="space-y-2">
                    {images.map((url, i) => (
                      <div className="flex items-center gap-2" key={i}>
                        <button
                          className="shrink-0 rounded-md border border-border px-1.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                          onClick={() => appendToken(i + 1)}
                          title={`Insert @image${i + 1} into the script`}
                          type="button"
                        >
                          @image{i + 1}
                        </button>
                        <Input
                          onChange={(e) =>
                            setImages((prev) =>
                              prev.map((v, j) => (j === i ? e.target.value : v)),
                            )
                          }
                          placeholder="https://…/product.jpg"
                          value={url}
                        />
                        <Button
                          onClick={() =>
                            setImages((prev) => prev.filter((_, j) => j !== i))
                          }
                          size="icon-sm"
                          type="button"
                          variant="ghost"
                        >
                          ×
                        </Button>
                      </div>
                    ))}
                    <Button
                      className="w-full"
                      disabled={images.length >= maxImages}
                      onClick={() => setImages((prev) => [...prev, ""])}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Add reference image
                    </Button>
                    <p className="text-[11px] text-muted-foreground">
                      Attaching any image switches the render to image-to-video;
                      with none it is text-to-video and the script is mandatory.
                    </p>
                  </div>
                </Control>

                <Control label="Niche" hint="optional — sets the spend cap">
                  <Select onValueChange={setNicheId} value={nicheId}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No niche (one-off)</SelectItem>
                      {niches.map((n) => (
                        <SelectItem key={n.id} value={n.id}>
                          {n.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Control>

                <Separator />

                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground">
                    {estimate === null ? (
                      "No pinned price for this combination"
                    ) : (
                      <>
                        <span className="font-mono font-medium tabular-nums text-foreground">
                          {formatUsd(estimate)}
                        </span>{" "}
                        est.
                        {rate !== null && (
                          <span className="ml-1">
                            ({formatUsd(rate)}/s × {params.duration}s)
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <Button disabled={!canSubmit} onClick={submit} size="sm">
                    {busy ? "Queueing…" : "Render"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* -------------------------------------------- render shelf */}
        <div className="space-y-4 lg:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">
              Renders
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                {renders.length}
              </span>
            </h2>
            {anyPending && (
              <span className="font-mono text-[11px] text-muted-foreground">
                live · refreshing
              </span>
            )}
          </div>

          {renders.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <h3 className="text-lg font-semibold">No renders yet</h3>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Write a script, attach the product shots it references, and the
                  first spokesperson ad lands here.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {renders.map((r) => {
                const m = models.find((x) => x.id === r.model_id);
                return (
                  <Card key={r.id}>
                    <CardContent className="space-y-3 py-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {m?.name ?? r.model_id}
                          </p>
                          <p className="font-mono text-[11px] text-muted-foreground">
                            {relative(r.created_at)}
                          </p>
                        </div>
                        <StatusBadge status={r.status} />
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        <Badge className="font-mono text-[10px]" variant="outline">
                          {r.render_mode === "image_to_video" ? "image→video" : "text→video"}
                        </Badge>
                        {r.aspect_ratio && (
                          <Badge className="font-mono text-[10px]" variant="outline">
                            {r.aspect_ratio}
                          </Badge>
                        )}
                        <Badge className="font-mono text-[10px]" variant="outline">
                          {r.duration_sec}s
                        </Badge>
                        {r.resolution && (
                          <Badge className="font-mono text-[10px]" variant="outline">
                            {r.resolution}
                          </Badge>
                        )}
                        {r.mode && (
                          <Badge className="font-mono text-[10px]" variant="outline">
                            {r.mode}
                          </Badge>
                        )}
                        <Badge className="font-mono text-[10px]" variant="outline">
                          {formatUsd(r.est_cost_usd)}
                        </Badge>
                      </div>

                      {r.status === "done" && r.video_url ? (
                        <video
                          className="w-full rounded-lg border border-border bg-black"
                          controls
                          playsInline
                          preload="metadata"
                          src={r.video_url}
                          style={{
                            aspectRatio: (r.aspect_ratio || "9:16").replace(":", " / "),
                          }}
                        />
                      ) : null}

                      {r.prompt && (
                        <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                          {r.prompt}
                        </p>
                      )}

                      {r.image_urls.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {r.image_urls.map((u, i) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              alt={`Reference @image${i + 1}`}
                              className="size-10 rounded border border-border object-cover"
                              key={`${u}-${i}`}
                              src={u}
                              title={`@image${i + 1}`}
                            />
                          ))}
                        </div>
                      )}

                      {r.error && (
                        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
                          {r.error}
                        </p>
                      )}

                      <div className="flex justify-end gap-1.5">
                        {r.status === "failed" && (
                          <Button
                            disabled={rowBusy === r.id}
                            onClick={() => onRetry(r.id)}
                            size="sm"
                            variant="outline"
                          >
                            Retry
                          </Button>
                        )}
                        <Button
                          disabled={rowBusy === r.id}
                          onClick={() => onDelete(r.id)}
                          size="sm"
                          variant="ghost"
                        >
                          Delete
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
