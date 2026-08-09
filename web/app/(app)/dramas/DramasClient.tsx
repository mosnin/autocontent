"use client";

// Micro-drama list + composer.
//
// A drama is an idea (or a finished script) driven through screenplay ->
// locked cast -> per-shot clips -> one stitched short. The differentiator is
// character consistency: each cast member gets ONE reference portrait that is
// reused as the image reference for every shot they appear in. That story is
// told on the detail page; this page's job is to start runs and show where
// each one is in the pipeline.

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
import type { Niche } from "@/lib/types";
import {
  createDrama,
  DEFAULT_SHOTS,
  DRAMA_ASPECTS,
  DRAMA_STAGES,
  DRAMA_STATUS_LABEL,
  dramaKeys,
  isDramaTerminal,
  MAX_SHOTS,
  MIN_SHOTS,
  type Drama,
  type DramaAspect,
  type DramaStatus,
} from "@/lib/dramas-client";

const POLL_MS = 10_000;

export function DramaStatusBadge({ status }: { status: DramaStatus }) {
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
      {DRAMA_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

/** How far along the queued -> … -> done rail a run is, 0..1. */
export function dramaProgress(status: DramaStatus): number {
  if (status === "failed") return 0;
  const i = DRAMA_STAGES.indexOf(status);
  return i < 0 ? 0 : i / (DRAMA_STAGES.length - 1);
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

export function DramasClient({
  initialDramas,
  niches,
}: {
  initialDramas: Drama[];
  niches: Niche[];
}) {
  const router = useRouter();

  // Poll only while a run is still moving; 0 turns the interval off entirely
  // once every drama is done or failed.
  const [pollMs, setPollMs] = React.useState(() =>
    initialDramas.some((d) => !isDramaTerminal(d)) ? POLL_MS : 0,
  );
  const { data, mutate } = useSWR<Drama[]>(dramaKeys.list(), clientFetch, {
    fallbackData: initialDramas,
    refreshInterval: pollMs,
  });
  const dramas = React.useMemo(() => data ?? [], [data]);
  const anyPending = dramas.some((d) => !isDramaTerminal(d));
  React.useEffect(() => {
    setPollMs(anyPending ? POLL_MS : 0);
  }, [anyPending]);

  const [mode, setMode] = React.useState<"idea" | "script">("idea");
  const [idea, setIdea] = React.useState("");
  const [script, setScript] = React.useState("");
  const [nicheId, setNicheId] = React.useState<string>(niches[0]?.id ?? "");
  const [shotCount, setShotCount] = React.useState(DEFAULT_SHOTS);
  const [aspect, setAspect] = React.useState<DramaAspect>("9:16");
  const [busy, setBusy] = React.useState(false);

  const text = mode === "idea" ? idea : script;
  const canSubmit = !busy && nicheId !== "" && text.trim().length > 0;

  async function submit() {
    setBusy(true);
    try {
      const created = await createDrama({
        niche_id: nicheId,
        // Exactly one source: a supplied script skips the screenwriter stage
        // (and its spend) entirely.
        idea: mode === "idea" ? idea.trim() : "",
        script: mode === "script" ? script.trim() : null,
        shot_count: shotCount,
        aspect,
      });
      toast.success("Drama queued");
      setIdea("");
      setScript("");
      void mutate();
      router.push(`/dramas/${created.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not queue the drama");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Micro-dramas</h1>
        <p className="text-sm text-muted-foreground">
          One idea becomes a screenplay, a locked cast, a shot list, and a
          stitched vertical short. Every character is generated once and reused
          in every shot they appear in, so the actor never changes mid-film.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* ------------------------------------------------ composer */}
        <Card className="lg:col-span-2 lg:sticky lg:top-4 lg:self-start">
          <CardContent className="space-y-5 py-5">
            <div className="flex gap-1.5">
              {(["idea", "script"] as const).map((m) => (
                <button
                  aria-pressed={mode === m}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                    mode === m
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                  key={m}
                  onClick={() => setMode(m)}
                  type="button"
                >
                  {m === "idea" ? "From an idea" : "From a finished script"}
                </button>
              ))}
            </div>

            {mode === "idea" ? (
              <div className="space-y-1.5">
                <span className="text-xs font-medium">Idea</span>
                <Textarea
                  maxLength={4000}
                  onChange={(e) => setIdea(e.target.value)}
                  placeholder="A barista realises the regular who orders the same drink every day has been leaving notes on the cups."
                  rows={5}
                  value={idea}
                />
                <p className="text-[11px] text-muted-foreground">
                  The screenwriter agent turns this into a title, logline, beats
                  and a shot list.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <span className="text-xs font-medium">Script</span>
                <Textarea
                  maxLength={20000}
                  onChange={(e) => setScript(e.target.value)}
                  placeholder={"INT. COFFEE SHOP - MORNING\n\nMAYA slides a cup across the counter…"}
                  rows={8}
                  value={script}
                />
                <p className="text-[11px] text-muted-foreground">
                  A supplied script skips the screenwriter stage entirely — and
                  never pays for it.
                </p>
              </div>
            )}

            <Separator />

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
              <p className="text-[11px] text-muted-foreground">
                Required — the niche supplies the spend cap that gates the run.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-medium">Shots</span>
                <span className="font-mono text-xs tabular-nums">{shotCount}</span>
              </div>
              <input
                aria-label="Shot count"
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                max={MAX_SHOTS}
                min={MIN_SHOTS}
                onChange={(e) => setShotCount(Number(e.target.value))}
                step={1}
                type="range"
                value={shotCount}
              />
              <p className="text-[11px] text-muted-foreground">
                Each shot costs one keyframe plus one clip, so the list is hard
                capped at {MAX_SHOTS}.
              </p>
            </div>

            <div className="space-y-1.5">
              <span className="text-xs font-medium">Aspect</span>
              <div className="flex gap-1.5">
                {DRAMA_ASPECTS.map((a) => (
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

            <Separator />

            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-muted-foreground">
                {niches.length === 0
                  ? "Create a niche first."
                  : `${shotCount} shots · ${aspect}`}
              </p>
              <Button disabled={!canSubmit} onClick={submit} size="sm">
                {busy ? "Queueing…" : "Create drama"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ---------------------------------------------------- list */}
        <div className="space-y-4 lg:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">
              Dramas
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                {dramas.length}
              </span>
            </h2>
            {anyPending && (
              <span className="font-mono text-[11px] text-muted-foreground">
                live · refreshing
              </span>
            )}
          </div>

          {dramas.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <h3 className="text-lg font-semibold">No dramas yet</h3>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Give the screenwriter one sentence of premise. It comes back
                  with a cast you can look in the eye.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {dramas.map((d) => {
                const title = d.plan?.screenplay?.title?.trim();
                const subtitle =
                  d.plan?.screenplay?.logline?.trim() ||
                  d.idea ||
                  (d.script ? "Supplied script" : "");
                const castCount = d.plan?.cast?.length ?? 0;
                const rendered =
                  d.plan?.shots?.filter((s) => !!s.clip_path).length ?? 0;
                const total = d.plan?.shots?.length ?? d.shot_count;
                return (
                  <Link className="block" href={`/dramas/${d.id}`} key={d.id}>
                    <Card className="transition-colors hover:border-primary/40">
                      <CardContent className="space-y-3 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {title || subtitle || d.id.slice(0, 8)}
                            </p>
                            {title && subtitle ? (
                              <p className="truncate text-xs text-muted-foreground">
                                {subtitle}
                              </p>
                            ) : null}
                          </div>
                          <DramaStatusBadge status={d.status} />
                        </div>

                        <div
                          aria-hidden
                          className="h-1 w-full overflow-hidden rounded-full bg-muted"
                        >
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              d.status === "failed" ? "bg-destructive" : "bg-primary",
                            )}
                            style={{
                              width: `${Math.round(
                                (d.status === "failed" ? 1 : dramaProgress(d.status)) * 100,
                              )}%`,
                            }}
                          />
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge className="font-mono text-[10px]" variant="outline">
                            {d.aspect}
                          </Badge>
                          <Badge className="font-mono text-[10px]" variant="outline">
                            {rendered}/{total} shots
                          </Badge>
                          {castCount > 0 && (
                            <Badge className="font-mono text-[10px]" variant="outline">
                              {castCount} cast
                            </Badge>
                          )}
                          {d.plan?.screenplay?.source === "script" && (
                            <Badge className="font-mono text-[10px]" variant="outline">
                              from script
                            </Badge>
                          )}
                          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                            {relative(d.created_at)}
                          </span>
                        </div>

                        {d.error && (
                          <p className="line-clamp-2 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
                            {d.error}
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
