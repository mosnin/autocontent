"use client";

// One motion project, shown as its beat plan.
//
// The transparency IS the feature: `motion_projects.beats` persists, per beat,
// WHICH strategy supplied the picture (generated keyframe vs. stock footage)
// and the exact keyword/prompt it used — including the keyword that missed
// when a stock lookup fell back to a generated frame (`stock_fallback:*` in
// the beat's tags). None of that is re-derived here; it is read straight off
// the row, so what the page says is what was actually rendered.

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";

import { Badge } from "@/components/square/ui/badge";
import { Button } from "@/components/square/ui/button";
import { Card, CardContent } from "@/components/square/ui/card";
import { Separator } from "@/components/square/ui/separator";
import { clientFetch } from "@/lib/client-fetcher";
import { cn } from "@/lib/utils";
import {
  beatsDuration,
  cssHex,
  fallbackReason,
  formatTimecode,
  isMotionTerminal,
  MOTION_SOURCE_LABEL,
  MOTION_STAGES,
  MOTION_STATUS_LABEL,
  motionKeys,
  motionVideoSrc,
  retryMotionProject,
  type MotionBeat,
  type MotionOverlay,
  type MotionProject,
  type MotionStyle,
} from "@/lib/motion-client";
import { MotionStatusBadge } from "../MotionClient";

const POLL_MS = 8_000;

function SourcingBadge({ sourcing }: { sourcing: string }) {
  return (
    <Badge
      className="font-mono text-[10px]"
      variant={sourcing === "stock" ? "secondary" : "outline"}
    >
      {sourcing === "stock" ? "stock" : "generated"}
    </Badge>
  );
}

export function MotionDetailClient({
  id,
  initial,
  styles,
}: {
  id: string;
  initial: MotionProject;
  styles: MotionStyle[];
}) {
  const [pollMs, setPollMs] = React.useState(() =>
    isMotionTerminal(initial) ? 0 : POLL_MS,
  );
  const { data, mutate } = useSWR<MotionProject>(motionKeys.project(id), clientFetch, {
    fallbackData: initial,
    refreshInterval: pollMs,
  });
  const project = data ?? initial;
  const pending = !isMotionTerminal(project);
  React.useEffect(() => {
    setPollMs(pending ? POLL_MS : 0);
  }, [pending]);

  const [busy, setBusy] = React.useState(false);

  const style = styles.find((s) => s.key === project.style_key);
  const beats = project.beats ?? [];
  const overlays = project.overlays ?? [];
  const total = beatsDuration(beats);
  const stageIndex = MOTION_STAGES.indexOf(project.status);

  const stockBeats = beats.filter((b) => b.broll?.sourcing === "stock").length;
  const fallbacks = beats.filter((b) => fallbackReason(b.broll) !== null).length;

  const overlaysByBeat = React.useMemo(() => {
    const map = new Map<number, MotionOverlay[]>();
    for (const o of overlays) {
      const list = map.get(o.beat_index) ?? [];
      list.push(o);
      map.set(o.beat_index, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.line - b.line);
    return map;
  }, [overlays]);

  async function onRetry() {
    setBusy(true);
    try {
      await retryMotionProject(id);
      toast.success("Resuming — keyframes already on the volume are reused");
      void mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            className="text-xs text-muted-foreground hover:text-foreground"
            href="/motion"
          >
            ← Motion graphics
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {style?.label ?? project.style_key}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {project.narration.trim() ||
              (project.job_id
                ? "Reusing an existing job's voiceover and transcript."
                : "—")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MotionStatusBadge status={project.status} />
          {project.status === "failed" && (
            <Button disabled={busy} onClick={onRetry} size="sm" variant="outline">
              {busy ? "Resuming…" : "Resume"}
            </Button>
          )}
        </div>
      </div>

      {/* Pipeline rail. */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
            {MOTION_STAGES.map((stage, i) => {
              const reached = project.status !== "failed" && i <= stageIndex;
              const current = project.status === stage;
              return (
                <React.Fragment key={stage}>
                  {i > 0 && (
                    <span
                      aria-hidden
                      className={cn("h-px w-4 sm:w-8", reached ? "bg-primary" : "bg-border")}
                    />
                  )}
                  <span
                    className={cn(
                      "font-mono text-[11px]",
                      current
                        ? "font-semibold text-foreground"
                        : reached
                          ? "text-foreground/70"
                          : "text-muted-foreground",
                    )}
                  >
                    {MOTION_STATUS_LABEL[stage]}
                  </span>
                </React.Fragment>
              );
            })}
          </div>
          {project.error && (
            <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
              {project.error}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Proportional timeline — one block per beat, width = its share of
              the runtime, colored by which strategy supplied the picture. */}
          {beats.length > 0 && total > 0 && (
            <section className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-medium">
                  Beat timeline
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {beats.length} beats · {formatTimecode(total)}
                  </span>
                </h2>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span aria-hidden className="size-2 rounded-sm bg-primary" />
                    generated
                  </span>
                  <span className="flex items-center gap-1">
                    <span aria-hidden className="size-2 rounded-sm bg-muted-foreground" />
                    stock
                  </span>
                </div>
              </div>
              <div className="flex h-7 w-full gap-px overflow-hidden rounded-md border border-border">
                {beats.map((b) => (
                  <span
                    className={cn(
                      "h-full min-w-[2px]",
                      b.broll?.sourcing === "stock"
                        ? "bg-muted-foreground/60"
                        : b.broll
                          ? "bg-primary/70"
                          : "bg-muted",
                    )}
                    key={b.index}
                    style={{ width: `${(b.duration / total) * 100}%` }}
                    title={`${formatTimecode(b.start)}–${formatTimecode(b.end)} · ${b.text}`}
                  />
                ))}
              </div>
            </section>
          )}

          <section className="space-y-3">
            <h2 className="text-sm font-medium">
              Beats
              {stockBeats > 0 && (
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {stockBeats} sourced from stock
                </span>
              )}
              {fallbacks > 0 && (
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  · {fallbacks} fell back
                </span>
              )}
            </h2>

            {beats.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  The beat plan appears once the narration has been transcribed.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {beats.map((b) => (
                  <BeatCard
                    beat={b}
                    key={b.index}
                    overlays={overlaysByBeat.get(b.index) ?? []}
                    style={style}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* --------------------------------------------- side column */}
        <div className="space-y-6">
          {project.status === "done" && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium">Composited video</h2>
              <video
                className="w-full rounded-lg border border-border bg-black"
                controls
                playsInline
                preload="metadata"
                src={motionVideoSrc(id)}
                style={{ aspectRatio: project.aspect.replace(":", " / ") }}
              />
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-medium">Setup</h2>
            <Card>
              <CardContent className="space-y-3 py-4">
                <div className="flex flex-wrap gap-1.5">
                  <Badge className="font-mono text-[10px]" variant="outline">
                    {project.aspect}
                  </Badge>
                  <Badge className="font-mono text-[10px]" variant="outline">
                    {MOTION_SOURCE_LABEL[project.source]} requested
                  </Badge>
                  <Badge className="font-mono text-[10px]" variant="outline">
                    {overlays.length} overlays
                  </Badge>
                </div>
                {style ? (
                  <>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {style.description}
                    </p>
                    <div
                      className="flex h-14 items-center justify-center rounded-md px-3"
                      style={{ background: style.preview.swatch }}
                    >
                      <span
                        className="text-center text-[11px] font-black leading-tight"
                        style={{
                          color: cssHex(style.preview.text_hex),
                          textShadow: `0 1px 0 ${cssHex(style.preview.outline_hex)}, 0 -1px 0 ${cssHex(style.preview.outline_hex)}, 1px 0 0 ${cssHex(style.preview.outline_hex)}, -1px 0 0 ${cssHex(style.preview.outline_hex)}`,
                          textTransform: style.preview.uppercase ? "uppercase" : "none",
                        }}
                      >
                        {style.preview.type_preview}
                      </span>
                    </div>
                    <dl className="space-y-1 text-[11px]">
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Palette</dt>
                        <dd className="text-right">{style.palette}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Finish</dt>
                        <dd className="text-right">{style.finish}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Type</dt>
                        <dd className="text-right font-mono">
                          {style.preview.animation} · {style.preview.position} ·{" "}
                          {style.preview.overlay_mode}
                        </dd>
                      </div>
                    </dl>
                  </>
                ) : null}

                {project.narration.trim() && (
                  <>
                    <Separator />
                    <div className="space-y-1">
                      <p className="text-[11px] font-medium">Narration</p>
                      <p className="max-h-56 overflow-auto text-xs leading-relaxed text-muted-foreground">
                        {project.narration}
                      </p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}

function BeatCard({
  beat,
  overlays,
  style,
}: {
  beat: MotionBeat;
  overlays: MotionOverlay[];
  style: MotionStyle | undefined;
}) {
  const broll = beat.broll;
  const fallback = fallbackReason(broll);

  return (
    <Card>
      <CardContent className="space-y-2.5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {String(beat.index + 1).padStart(2, "0")}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {formatTimecode(beat.start)} → {formatTimecode(beat.end)}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            ({beat.duration.toFixed(1)}s)
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            {broll ? <SourcingBadge sourcing={broll.sourcing} /> : null}
            {broll?.camera_move ? (
              <Badge className="font-mono text-[10px]" variant="outline">
                {broll.camera_move}
              </Badge>
            ) : null}
            {broll?.status ? (
              <Badge
                className="font-mono text-[10px]"
                variant={broll.status === "ready" ? "secondary" : "outline"}
              >
                {broll.status}
              </Badge>
            ) : null}
          </span>
        </div>

        <p className="text-sm leading-relaxed">{beat.text}</p>

        {/* Kinetic type actually burned for this beat. */}
        {overlays.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {overlays.map((o, i) => (
              <span
                className="rounded border border-border px-1.5 py-0.5 text-[10px] font-bold"
                key={i}
                style={{
                  textTransform: style?.preview.uppercase ? "uppercase" : "none",
                }}
                title={`${o.animation} · ${o.position} · line ${o.line + 1}/${o.line_count} · ${formatTimecode(o.start)}–${formatTimecode(o.end)}`}
              >
                {o.text}
              </span>
            ))}
          </div>
        )}

        {broll ? (
          <div className="space-y-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-2">
            {broll.sourcing === "stock" ? (
              <>
                {broll.keyword && (
                  <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
                    <span className="font-semibold text-foreground/70">keyword</span>{" "}
                    {broll.keyword}
                  </p>
                )}
                {broll.stock_query && (
                  <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
                    <span className="font-semibold text-foreground/70">searched</span>{" "}
                    {broll.stock_query}
                  </p>
                )}
                {broll.stock_url && (
                  <p className="truncate font-mono text-[10px] text-muted-foreground">
                    <span className="font-semibold text-foreground/70">footage</span>{" "}
                    <a
                      className="underline underline-offset-2 hover:text-foreground"
                      href={broll.stock_url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {broll.stock_url}
                    </a>
                  </p>
                )}
              </>
            ) : (
              <>
                {broll.keyword && (
                  <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
                    <span className="font-semibold text-foreground/70">
                      keyword that missed
                    </span>{" "}
                    {broll.keyword}
                  </p>
                )}
                {broll.prompt && (
                  <p className="line-clamp-4 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    <span className="font-semibold text-foreground/70">prompt</span>{" "}
                    {broll.prompt}
                  </p>
                )}
              </>
            )}

            {fallback && (
              <p className="text-[10px] text-amber-700 dark:text-amber-400">
                Stock lookup missed ({fallback}) — this beat was rescued by a
                generated keyframe.
              </p>
            )}

            {broll.tags.filter((t) => !t.startsWith("stock_fallback:")).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {broll.tags
                  .filter((t) => !t.startsWith("stock_fallback:"))
                  .map((t) => (
                    <Badge className="font-mono text-[10px]" key={t} variant="outline">
                      {t}
                    </Badge>
                  ))}
              </div>
            )}

            {broll.error && (
              <p className="text-[10px] text-destructive">{broll.error}</p>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            No picture plan for this beat yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
