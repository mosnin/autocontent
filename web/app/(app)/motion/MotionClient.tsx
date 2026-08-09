"use client";

// Motion graphics composer + project list.
//
// The style picker renders each style's own typographic treatment from the
// catalog's `preview` block (font casing, text/outline color, swatch), so a
// look can be judged without paying for a render. Everything else is the
// narration and the two knobs that decide what the picture track is made of:
// aspect, and which b-roll sourcing strategy to ask for.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";

import { Badge } from "@/components/square/ui/badge";
import { Button } from "@/components/square/ui/button";
import { Card, CardContent } from "@/components/square/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/square/ui/select";
import { Separator } from "@/components/square/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { clientFetch } from "@/lib/client-fetcher";
import { cn } from "@/lib/utils";
import type { Job, Niche } from "@/lib/types";
import {
  createMotionProject,
  cssHex,
  isMotionTerminal,
  MAX_NARRATION_CHARS,
  MOTION_ASPECTS,
  MOTION_SOURCE_HINT,
  MOTION_SOURCE_LABEL,
  MOTION_SOURCES,
  MOTION_STAGES,
  MOTION_STATUS_LABEL,
  motionKeys,
  type MotionAspect,
  type MotionProject,
  type MotionSource,
  type MotionStatus,
  type MotionStyle,
} from "@/lib/motion-client";

const POLL_MS = 10_000;

export function MotionStatusBadge({ status }: { status: MotionStatus }) {
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
      {MOTION_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

export function motionProgress(status: MotionStatus): number {
  if (status === "failed") return 1;
  const i = MOTION_STAGES.indexOf(status);
  return i < 0 ? 0 : i / (MOTION_STAGES.length - 1);
}

function relative(iso: string): string {
  const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${Math.max(sec, 0)}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

/** One catalog entry, drawn in its own type treatment. The colors are style
 *  DATA (ffmpeg drawtext hex), not app chrome, so they're inline on purpose —
 *  the card frame around them still uses theme tokens. */
function StyleCard({
  style,
  selected,
  onSelect,
}: {
  style: MotionStyle;
  selected: boolean;
  onSelect: () => void;
}) {
  const p = style.preview;
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "group overflow-hidden rounded-lg border text-left transition-colors",
        selected ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/40",
      )}
      onClick={onSelect}
      type="button"
    >
      <div
        className="flex h-16 items-center justify-center px-3"
        style={{ background: p.swatch }}
      >
        <span
          className="text-center text-[11px] font-black leading-tight"
          style={{
            color: cssHex(p.text_hex),
            textShadow: `0 1px 0 ${cssHex(p.outline_hex)}, 0 -1px 0 ${cssHex(p.outline_hex)}, 1px 0 0 ${cssHex(p.outline_hex)}, -1px 0 0 ${cssHex(p.outline_hex)}`,
            textTransform: p.uppercase ? "uppercase" : "none",
          }}
        >
          {p.type_preview}
        </span>
      </div>
      <div className="space-y-1 bg-card px-3 py-2">
        <p className="text-xs font-medium">{style.label}</p>
        <p className="font-mono text-[10px] text-muted-foreground">
          {p.animation} · {p.position} · {p.overlay_mode}
        </p>
      </div>
    </button>
  );
}

export function MotionClient({
  initialProjects,
  styles,
  niches,
  jobs,
}: {
  initialProjects: MotionProject[];
  styles: MotionStyle[];
  niches: Niche[];
  jobs: Job[];
}) {
  const router = useRouter();

  const [pollMs, setPollMs] = React.useState(() =>
    initialProjects.some((p) => !isMotionTerminal(p)) ? POLL_MS : 0,
  );
  const { data, mutate } = useSWR<MotionProject[]>(motionKeys.projects(), clientFetch, {
    fallbackData: initialProjects,
    refreshInterval: pollMs,
  });
  const projects = React.useMemo(() => data ?? [], [data]);
  const anyPending = projects.some((p) => !isMotionTerminal(p));
  React.useEffect(() => {
    setPollMs(anyPending ? POLL_MS : 0);
  }, [anyPending]);

  const [narration, setNarration] = React.useState("");
  const [jobId, setJobId] = React.useState<string>("none");
  const [styleKey, setStyleKey] = React.useState(styles[0]?.key ?? "modern-flat");
  const [aspect, setAspect] = React.useState<MotionAspect>("9:16");
  const [source, setSource] = React.useState<MotionSource>("generated");
  const [nicheId, setNicheId] = React.useState(niches[0]?.id ?? "");
  const [busy, setBusy] = React.useState(false);

  const reusingJob = jobId !== "none";
  const style = styles.find((s) => s.key === styleKey);
  const canSubmit =
    !busy && nicheId !== "" && (reusingJob || narration.trim().length > 0);

  async function submit() {
    setBusy(true);
    try {
      const created = await createMotionProject({
        niche_id: nicheId,
        narration: reusingJob ? "" : narration.trim(),
        job_id: reusingJob ? jobId : null,
        style_key: styleKey,
        aspect,
        source,
      });
      toast.success("Motion project queued");
      setNarration("");
      void mutate();
      router.push(`/motion/${created.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not queue the project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Motion graphics</h1>
        <p className="text-sm text-muted-foreground">
          Narration becomes timed beats; every beat gets its own b-roll and its
          own line of kinetic type, composited into one video. The plan is kept,
          so you can see exactly what supplied each beat.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* ------------------------------------------------ composer */}
        <Card className="lg:col-span-2 lg:sticky lg:top-4 lg:self-start">
          <CardContent className="space-y-5 py-5">
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-medium">Narration</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {narration.length}/{MAX_NARRATION_CHARS}
                </span>
              </div>
              <Textarea
                disabled={reusingJob}
                maxLength={MAX_NARRATION_CHARS}
                onChange={(e) => setNarration(e.target.value)}
                placeholder="Most people think compound interest is boring. Then they see the second decade…"
                rows={6}
                value={narration}
              />
              <p className="text-[11px] text-muted-foreground">
                {reusingJob
                  ? "Disabled — this project is reusing an existing job's voiceover."
                  : "Sentence boundaries become beats, and beats decide both the cuts and the type."}
              </p>
            </div>

            {jobs.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-xs font-medium">Reuse a voiceover</span>
                <Select onValueChange={setJobId} value={jobId}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Synthesize a new voiceover</SelectItem>
                    {jobs.map((j) => (
                      <SelectItem key={j.id} value={j.id}>
                        {j.script?.idea?.hook ?? j.id.slice(0, 8)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Borrows that job&apos;s voiceover and transcript instead of
                  paying for TTS again.
                </p>
              </div>
            )}

            <Separator />

            <div className="space-y-1.5">
              <span className="text-xs font-medium">Style</span>
              {styles.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  The style catalog is unavailable right now.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {styles.map((s) => (
                    <StyleCard
                      key={s.key}
                      onSelect={() => setStyleKey(s.key)}
                      selected={s.key === styleKey}
                      style={s}
                    />
                  ))}
                </div>
              )}
              {style ? (
                <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {style.description}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <span className="text-xs font-medium">B-roll source</span>
              <div className="flex flex-wrap gap-1.5">
                {MOTION_SOURCES.map((s) => (
                  <button
                    aria-pressed={s === source}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs transition-colors",
                      s === source
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                    key={s}
                    onClick={() => setSource(s)}
                    type="button"
                  >
                    {MOTION_SOURCE_LABEL[s]}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {MOTION_SOURCE_HINT[source]}
              </p>
            </div>

            <div className="space-y-1.5">
              <span className="text-xs font-medium">Aspect</span>
              <div className="flex gap-1.5">
                {MOTION_ASPECTS.map((a) => (
                  <button
                    aria-pressed={a === aspect}
                    className={cn(
                      "rounded-md border px-2.5 py-1 font-mono text-xs transition-colors",
                      a === aspect
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                    key={a}
                    onClick={() => setAspect(a)}
                    type="button"
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-xs font-medium">Niche</span>
              <Select onValueChange={setNicheId} value={nicheId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a niche" />
                </SelectTrigger>
                <SelectContent>
                  {niches.map((n) => (
                    <SelectItem key={n.id} value={n.id}>
                      {n.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-muted-foreground">
                {niches.length === 0 ? "Create a niche first." : `${aspect} · ${styleKey}`}
              </p>
              <Button disabled={!canSubmit} onClick={submit} size="sm">
                {busy ? "Queueing…" : "Create project"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ---------------------------------------------------- list */}
        <div className="space-y-4 lg:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">
              Projects
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                {projects.length}
              </span>
            </h2>
            {anyPending && (
              <span className="font-mono text-[11px] text-muted-foreground">
                live · refreshing
              </span>
            )}
          </div>

          {projects.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <h3 className="text-lg font-semibold">No motion projects yet</h3>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Paste a script. You get back a beat-by-beat plan showing which
                  strategy supplied each picture and the exact term it searched.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {projects.map((p) => {
                const stockBeats = p.beats.filter(
                  (b) => b.broll?.sourcing === "stock",
                ).length;
                const s = styles.find((x) => x.key === p.style_key);
                return (
                  <Link className="block" href={`/motion/${p.id}`} key={p.id}>
                    <Card className="transition-colors hover:border-primary/40">
                      <CardContent className="space-y-3 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="line-clamp-2 text-sm font-medium">
                              {p.narration.trim() ||
                                (p.job_id
                                  ? "Reused voiceover from a job"
                                  : p.id.slice(0, 8))}
                            </p>
                            <p className="font-mono text-[11px] text-muted-foreground">
                              {s?.label ?? p.style_key} · {relative(p.created_at)}
                            </p>
                          </div>
                          <MotionStatusBadge status={p.status} />
                        </div>

                        <div
                          aria-hidden
                          className="h-1 w-full overflow-hidden rounded-full bg-muted"
                        >
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              p.status === "failed" ? "bg-destructive" : "bg-primary",
                            )}
                            style={{ width: `${Math.round(motionProgress(p.status) * 100)}%` }}
                          />
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          <Badge className="font-mono text-[10px]" variant="outline">
                            {p.aspect}
                          </Badge>
                          <Badge className="font-mono text-[10px]" variant="outline">
                            {p.beats.length} beats
                          </Badge>
                          <Badge className="font-mono text-[10px]" variant="outline">
                            {MOTION_SOURCE_LABEL[p.source]}
                          </Badge>
                          {stockBeats > 0 && (
                            <Badge className="font-mono text-[10px]" variant="outline">
                              {stockBeats} stock
                            </Badge>
                          )}
                          {p.overlays.length > 0 && (
                            <Badge className="font-mono text-[10px]" variant="outline">
                              {p.overlays.length} overlays
                            </Badge>
                          )}
                        </div>

                        {p.error && (
                          <p className="line-clamp-2 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
                            {p.error}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
