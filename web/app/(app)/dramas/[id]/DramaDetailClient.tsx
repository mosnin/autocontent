"use client";

// One micro-drama, shown as the three structures the pipeline actually
// produces: the screenplay, the LOCKED CAST, and the shot list.
//
// The cast is deliberately first-class. A drama's continuity anchor is a
// per-drama cast — each character's reference portrait is generated once and
// then reused as the image reference for every shot they appear in — so the
// page shows the portrait large in the cast strip AND repeats it as a small
// chip on every shot that character appears in. That repetition is the
// feature made visible: the same face, shot after shot.

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
  characterImageSrc,
  DRAMA_STAGES,
  DRAMA_STATUS_LABEL,
  dramaKeys,
  dramaVideoSrc,
  isDramaTerminal,
  retryDrama,
  type CastMember,
  type DramaDetail,
  type DramaShot,
  type ShotStatus,
} from "@/lib/dramas-client";
import { DramaStatusBadge } from "../DramasClient";

const POLL_MS = 8_000;

const SHOT_STATUS_LABEL: Record<ShotStatus, string> = {
  pending: "Pending",
  framed: "Framed",
  rendered: "Rendered",
};

function ShotStatusBadge({ status }: { status: ShotStatus }) {
  return (
    <Badge
      className="font-mono text-[10px]"
      variant={status === "rendered" ? "secondary" : "outline"}
    >
      {SHOT_STATUS_LABEL[status]}
    </Badge>
  );
}

/** A cast member's locked portrait. Rendered from the ownership-scoped
 *  character-image endpoint; `has_reference_image` already tells us the file
 *  exists on the volume, so a missing one falls back to initials instead of a
 *  broken image. */
function Portrait({
  dramaId,
  member,
  size = "lg",
}: {
  dramaId: string;
  member: CastMember;
  size?: "lg" | "sm";
}) {
  const box = size === "lg" ? "size-20" : "size-7";
  if (!member.has_reference_image) {
    return (
      <span
        className={cn(
          box,
          "flex shrink-0 items-center justify-center rounded-full border border-dashed border-border bg-muted text-[10px] font-medium text-muted-foreground",
        )}
        title={`${member.name} — portrait not locked yet`}
      >
        {member.name.slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={`${member.name} reference portrait`}
      className={cn(box, "shrink-0 rounded-full border border-border object-cover")}
      src={characterImageSrc(dramaId, member.id)}
      title={member.name}
    />
  );
}

export function DramaDetailClient({
  id,
  initial,
}: {
  id: string;
  initial: DramaDetail;
}) {
  const [pollMs, setPollMs] = React.useState(() =>
    isDramaTerminal(initial.drama) ? 0 : POLL_MS,
  );
  const { data, mutate } = useSWR<DramaDetail>(dramaKeys.detail(id), clientFetch, {
    fallbackData: initial,
    refreshInterval: pollMs,
  });
  const detail = data ?? initial;
  const { drama, screenplay, cast, shots, has_video: hasVideo } = detail;
  const pending = !isDramaTerminal(drama);
  React.useEffect(() => {
    setPollMs(pending ? POLL_MS : 0);
  }, [pending]);

  const [busy, setBusy] = React.useState(false);
  const byId = React.useMemo(
    () => new Map(cast.map((c) => [c.id, c])),
    [cast],
  );

  async function onRetry() {
    setBusy(true);
    try {
      await retryDrama(id);
      toast.success("Resuming — the screenplay and locked portraits are kept");
      void mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setBusy(false);
    }
  }

  const renderedShots = shots.filter((s) => s.has_clip).length;
  const lockedPortraits = cast.filter((c) => c.has_reference_image).length;
  const stageIndex = DRAMA_STAGES.indexOf(drama.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            className="text-xs text-muted-foreground hover:text-foreground"
            href="/dramas"
          >
            ← Micro-dramas
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {screenplay?.title?.trim() || drama.idea || `Drama ${drama.id.slice(0, 8)}`}
          </h1>
          {screenplay?.logline ? (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {screenplay.logline}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <DramaStatusBadge status={drama.status} />
          {drama.status === "failed" && (
            <Button disabled={busy} onClick={onRetry} size="sm" variant="outline">
              {busy ? "Resuming…" : "Resume"}
            </Button>
          )}
        </div>
      </div>

      {/* Pipeline rail — where the run is, and what it has already paid for. */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
            {DRAMA_STAGES.map((stage, i) => {
              const reached = drama.status !== "failed" && i <= stageIndex;
              const current = drama.status === stage;
              return (
                <React.Fragment key={stage}>
                  {i > 0 && (
                    <span
                      aria-hidden
                      className={cn(
                        "h-px w-4 sm:w-8",
                        reached ? "bg-primary" : "bg-border",
                      )}
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
                    {DRAMA_STATUS_LABEL[stage]}
                  </span>
                </React.Fragment>
              );
            })}
          </div>
          {drama.error && (
            <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
              {drama.error}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ------------------------------------------------- the film */}
        <div className="space-y-6 lg:col-span-2">
          {/* Cast — the consistency anchor, first-class. */}
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-medium">
                Cast
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {lockedPortraits}/{cast.length} locked
                </span>
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Each portrait is generated once and reused in every shot.
              </p>
            </div>
            {cast.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  The casting stage hasn&apos;t run yet.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {cast.map((c) => (
                  <Card key={c.id}>
                    <CardContent className="flex gap-3 py-4">
                      <Portrait dramaId={id} member={c} />
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium">{c.name}</p>
                          {c.has_reference_image ? (
                            <Badge className="font-mono text-[10px]" variant="secondary">
                              locked
                            </Badge>
                          ) : (
                            <Badge className="font-mono text-[10px]" variant="outline">
                              pending
                            </Badge>
                          )}
                        </div>
                        {c.role && (
                          <p className="truncate text-xs text-muted-foreground">
                            {c.role}
                          </p>
                        )}
                        {c.static_features && (
                          <p className="line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">
                            {c.static_features}
                          </p>
                        )}
                        {c.wardrobe && (
                          <p className="line-clamp-2 text-[11px] italic leading-relaxed text-muted-foreground">
                            wearing {c.wardrobe}
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {/* Shots. */}
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-medium">
                Shots
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {renderedShots}/{shots.length} rendered
                </span>
              </h2>
            </div>
            {shots.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  The shot list appears once the screenplay is written.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {shots.map((s) => (
                  <ShotCard byId={byId} dramaId={id} key={s.index} shot={s} />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* --------------------------------------------- side column */}
        <div className="space-y-6">
          {hasVideo && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium">The short</h2>
              <video
                className="w-full rounded-lg border border-border bg-black"
                controls
                playsInline
                preload="metadata"
                src={dramaVideoSrc(id)}
                style={{ aspectRatio: drama.aspect.replace(":", " / ") }}
              />
              {drama.duration_sec ? (
                <p className="font-mono text-[11px] text-muted-foreground">
                  {drama.duration_sec.toFixed(1)}s · {drama.aspect}
                </p>
              ) : null}
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-medium">Screenplay</h2>
            <Card>
              <CardContent className="space-y-3 py-4">
                <div className="flex flex-wrap gap-1.5">
                  <Badge className="font-mono text-[10px]" variant="outline">
                    {screenplay?.source === "script" ? "supplied script" : "written"}
                  </Badge>
                  <Badge className="font-mono text-[10px]" variant="outline">
                    {drama.aspect}
                  </Badge>
                  <Badge className="font-mono text-[10px]" variant="outline">
                    {drama.shot_count} shots requested
                  </Badge>
                </div>

                {screenplay?.beats && screenplay.beats.length > 0 ? (
                  <ol className="space-y-1.5">
                    {screenplay.beats.map((b, i) => (
                      <li className="flex gap-2 text-xs leading-relaxed" key={i}>
                        <span className="shrink-0 font-mono text-muted-foreground">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ol>
                ) : null}

                {screenplay?.source === "script" && screenplay.script_text ? (
                  <>
                    <Separator />
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">
                      {screenplay.script_text}
                    </pre>
                  </>
                ) : null}

                {!screenplay && (
                  <p className="text-xs text-muted-foreground">
                    Not written yet.
                  </p>
                )}

                {drama.idea && (
                  <>
                    <Separator />
                    <div className="space-y-1">
                      <p className="text-[11px] font-medium">Premise</p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {drama.idea}
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

function ShotCard({
  shot,
  dramaId,
  byId,
}: {
  shot: DramaShot;
  dramaId: string;
  byId: Map<string, CastMember>;
}) {
  const members = shot.character_ids
    .map((cid) => byId.get(cid))
    .filter((c): c is CastMember => c !== undefined);

  return (
    <Card>
      <CardContent className="space-y-2.5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {String(shot.index + 1).padStart(2, "0")}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium uppercase">
            {shot.slugline || "—"}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {shot.duration_sec.toFixed(1)}s
          </span>
          <ShotStatusBadge status={shot.status} />
        </div>

        {/* The same locked faces, shot after shot. */}
        {members.length > 0 && (
          <div className="flex items-center gap-1.5">
            {members.map((m) => (
              <span className="flex items-center gap-1" key={m.id}>
                <Portrait dramaId={dramaId} member={m} size="sm" />
                <span className="text-[11px] text-muted-foreground">{m.name}</span>
              </span>
            ))}
          </div>
        )}

        {shot.action && (
          <p className="text-xs leading-relaxed text-muted-foreground">{shot.action}</p>
        )}
        {shot.dialogue && (
          <p className="border-l-2 border-border pl-2.5 text-xs italic leading-relaxed">
            “{shot.dialogue}”
          </p>
        )}

        {(shot.visual_prompt || shot.motion_prompt) && (
          <div className="space-y-1 rounded-md border border-border bg-muted/30 px-2.5 py-2">
            {shot.visual_prompt && (
              <p className="line-clamp-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground/70">keyframe</span>{" "}
                {shot.visual_prompt}
              </p>
            )}
            {shot.motion_prompt && (
              <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground/70">motion</span>{" "}
                {shot.motion_prompt}
              </p>
            )}
          </div>
        )}

        <div className="flex gap-1.5">
          <Badge
            className="font-mono text-[10px]"
            variant={shot.has_keyframe ? "secondary" : "outline"}
          >
            keyframe {shot.has_keyframe ? "✓" : "—"}
          </Badge>
          <Badge
            className="font-mono text-[10px]"
            variant={shot.has_clip ? "secondary" : "outline"}
          >
            clip {shot.has_clip ? "✓" : "—"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
