"use client";

import { Film, Pencil, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  Button,
  ButtonLink,
  Callout,
  Card,
  Column,
  Field,
  IconButton,
  Input,
  Meter,
  Modal,
  Notice,
  NotAllowed,
  PageHeader,
  PlanCard,
  Section,
  Skeleton,
  StatusBadge,
  StepMark,
  Textarea,
  cssFallback,
  cx,
  paletteFor,
  useAllowed,
  usePending,
} from "@/design-system";
import { LiveRefresh, toolGlyph } from "@/components/app/content/shared";
import { formatUsd } from "@/lib/format";
import { storyApi } from "./story-api";
import { STORY_BUSY, STORY_STATUS_LABEL, STORY_STEPS, storyMedia, storyStep, storyTone, type Story, type StoryScene, type StoryShot } from "./types";

type Key = "save" | "revise" | "board" | "redraw" | "render" | "approve" | "decline" | "retry";
const RATIO = { "9:16": "9/16", "16:9": "16/9", "1:1": "1/1" } as const;

/** One story video, as the step it is on: script → storyboard → render → video. One primary action per step. */
export function StoryView({ story: initial, preview }: { story: Story; preview?: boolean }) {
  const router = useRouter();
  const [story, setStory] = useState(initial);
  useEffect(() => setStory(initial), [initial]);
  const pending = usePending<Key>();
  const canMake = useAllowed("content:create");
  const step = storyStep(story);
  const busy = STORY_BUSY.has(story.status);

  /** Run a write; the server's answer replaces the story, then the server data refreshes. */
  const act = (key: Key, fn: () => Promise<Story>) =>
    pending.run(key, async () => {
      if (preview) return;
      setStory(await fn());
      router.refresh();
    });

  return (
    <>
      <LiveRefresh active={busy && !preview} ms={4000} />
      <PageHeader
        icon={toolGlyph("content")}
        crumbs={[{ label: "Content", href: "/content" }, { label: "Story videos", href: "/content/stories" }, { label: story.title || "Untitled story" }]}
        actions={<StatusBadge tone={storyTone(story.status)}>{STORY_STATUS_LABEL[story.status]}</StatusBadge>}
      />
      <Column width="lg" title={story.title || "Untitled story"} description={story.logline || clip(story.source, 160)} control={<Steps current={step} failed={story.status === "failed"} working={busy} complete={story.status === "done"} />}>
        {/* Keyed by status: each step arrives with the system's enter motion, once. */}
        <div key={story.status} className="ds-enter space-y-6">
          {story.status === "failed" && (
            <Callout
              tone="negative"
              title={`Stopped at the ${STORY_STEPS[step]!.label.toLowerCase()}`}
              action={
                <Button variant="primary" onClick={() => act("retry", () => storyApi.retry(story.id))} loading={pending.busy === "retry"} disabled={!canMake}>
                  Resume
                </Button>
              }
            >
              {(story.error ?? "Something went wrong.").replace(/\.?$/, ".")} Finished shots and frames are kept; resuming picks up where it stopped.
            </Callout>
          )}
          {step === 0 && <ScriptStep story={story} act={act} pending={pending} canMake={canMake} />}
          {step === 1 && <StoryboardStep story={story} act={act} pending={pending} canMake={canMake} preview={preview} />}
          {step === 2 && <RenderStep story={story} act={act} pending={pending} preview={preview} />}
          {step === 3 && <VideoStep story={story} act={act} pending={pending} canMake={canMake} preview={preview} />}
          {!canMake && <NotAllowed>Owners, admins and marketers can change story videos.</NotAllowed>}
        </div>
      </Column>
    </>
  );
}

type Act = (key: Key, fn: () => Promise<Story>) => Promise<boolean>;
type Pending = ReturnType<typeof usePending<Key>>;

/** Enough rows to show the scene without an inner scroll, up to a point. */
function scriptRows(text: string) {
  const lines = text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 100)), 0);
  return Math.min(16, Math.max(4, lines + 1));
}

function clip(text: string, n: number) {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

/* ------------------------------------------------------------ steps header */

function Steps({ current, failed, working, complete }: { current: number; failed: boolean; working: boolean; complete: boolean }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2" aria-label="Steps">
      {STORY_STEPS.map((s, i) => {
        // The spinner means work in progress; a step waiting on the person is an open mark with a bright label.
        const state = complete || i < current ? "done" : i === current ? (failed ? "failed" : working ? "active" : "todo") : "todo";
        const lit = state !== "todo" || i === current;
        return (
          <li key={s.id} className="flex items-center gap-3" aria-current={i === current ? "step" : undefined}>
            <span className="flex items-center gap-1.5 text-[12.5px]">
              <StepMark state={state} />
              <span className={lit ? "text-fg" : "text-fg-faint"}>{s.label}</span>
            </span>
            {i < STORY_STEPS.length - 1 && <span aria-hidden className="hidden h-px w-6 bg-hairline-strong sm:block" />}
          </li>
        );
      })}
    </ol>
  );
}

/** The one bar at the bottom of a step: what happens next on the left, the primary action on the right. */
function ActionBar({ children, actions, error }: { children?: ReactNode; actions: ReactNode; error?: string | null }) {
  return (
    <div className="space-y-2 border-t border-hairline pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-fg-muted tabular">{children}</p>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      <Notice error={error} />
    </div>
  );
}

function Working({ children }: { children: ReactNode }) {
  return <p className="ds-shimmer text-[13px]">{children}</p>;
}

/* ------------------------------------------------------------ 1 · script */

function ScriptStep({ story, act, pending, canMake }: { story: Story; act: Act; pending: Pending; canMake: boolean }) {
  const [scenes, setScenes] = useState<StoryScene[]>(story.scenes);
  const [note, setNote] = useState("");
  useEffect(() => setScenes(story.scenes), [story.scenes]);
  const dirty = JSON.stringify(scenes) !== JSON.stringify(story.scenes);

  if (story.status === "writing" || (story.status === "failed" && story.scenes.length === 0)) {
    return (
      <div className="space-y-4">
        {story.status === "writing" && <Working>{story.revision > 0 || story.scenes.length ? "Revising the script" : story.mode === "idea" ? "Writing the story, then the script" : "Breaking the script into scenes"}</Working>}
        {[0, 1].map((i) => (
          <Card key={i} className="space-y-2.5 p-4">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-2/3" />
          </Card>
        ))}
      </div>
    );
  }

  const update = (i: number, patch: Partial<StoryScene>) => setScenes((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const board = () =>
    act("board", async () => {
      if (dirty) await storyApi.saveScript(story.id, scenes);
      return storyApi.storyboard(story.id);
    });

  return (
    <div className="space-y-4">
      {scenes.map((s, i) => (
        <Card key={i} className="space-y-2 p-4">
          <div className="flex items-center gap-3">
            <span className="shrink-0 whitespace-nowrap text-[12px] text-fg-faint tabular">Scene {i + 1}</span>
            <Input aria-label={`Scene ${i + 1} heading`} value={s.heading} onChange={(e) => update(i, { heading: e.target.value })} maxLength={200} className="h-7 border-transparent bg-transparent px-1 font-medium hover:border-hairline" disabled={!canMake} />
          </div>
          <Textarea aria-label={`Scene ${i + 1} script`} rows={scriptRows(s.script)} value={s.script} onChange={(e) => update(i, { script: e.target.value })} maxLength={6000} disabled={!canMake} />
        </Card>
      ))}
      <Card className="flex flex-wrap items-center gap-2 p-3">
        <Input aria-label="Revision note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="Ask for a change: shorter, a twist at the end, more dialogue…" className="min-w-0 flex-1" disabled={!canMake} />
        <Button variant="secondary" onClick={() => act("revise", () => storyApi.revise(story.id, note)).then((ok) => ok && setNote(""))} loading={pending.busy === "revise"} disabled={note.trim().length < 2 || !canMake || pending.busy !== null}>
          Revise
        </Button>
      </Card>
      <ActionBar
        error={pending.error}
        actions={
          <>
            {dirty && (
              <Button variant="ghost" onClick={() => act("save", () => storyApi.saveScript(story.id, scenes))} loading={pending.busy === "save"} disabled={!canMake || pending.busy !== null}>
                Save changes
              </Button>
            )}
            <Button variant="primary" onClick={board} loading={pending.busy === "board"} disabled={!canMake || pending.busy !== null || story.status !== "script_ready"}>
              Draw the storyboard
            </Button>
          </>
        }
      >
        Next: the cast, a reference portrait for each character, and one frame per shot.
      </ActionBar>
    </div>
  );
}

/* ------------------------------------------------------------ 2 · storyboard */

function StoryboardStep({ story, act, pending, canMake, preview }: { story: Story; act: Act; pending: Pending; canMake: boolean; preview?: boolean }) {
  const drawing = story.status === "boarding";
  const { frames, shots } = story.progress;
  return (
    <div className="space-y-6">
      {drawing && <Working>{shots ? `Drawing frames · ${frames} of ${shots}` : "Planning the shots"}</Working>}
      <Cast story={story} preview={preview} />
      <Board story={story} act={act} pending={pending} canRedraw={canMake && story.status === "storyboard_ready"} preview={preview} />
      {story.status === "storyboard_ready" && (
        <ActionBar
          error={pending.error}
          actions={
            <Button variant="primary" onClick={() => act("render", () => storyApi.render(story.id))} loading={pending.busy === "render"} disabled={!canMake || pending.busy !== null}>
              Render
            </Button>
          }
        >
          {story.shots.length} shots · about {formatUsd(story.estimate_usd)}
          {story.needs_approval ? " · needs a spend approval" : ""}
        </ActionBar>
      )}
    </div>
  );
}

function Cast({ story, preview }: { story: Story; preview?: boolean }) {
  const cast = story.characters.filter((c) => c.visible);
  if (cast.length === 0) return null;
  return (
    <Section title="Cast">
      <ul className="flex flex-wrap gap-4">
        {cast.map((c) => {
          const idx = story.characters.indexOf(c);
          const ready = story.portraits.includes(c.name);
          return (
            <li key={c.name} className="flex w-44 items-center gap-2.5">
              <span className="relative size-10 shrink-0 overflow-hidden rounded-full border border-hairline bg-surface-2">
                {ready && <Img src={`/api/proxy/api/v1/stories/${encodeURIComponent(story.id)}/characters/${idx}/portrait?r=${story.revision}`} alt={c.name} preview={preview} seed={c.name} />}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-fg">{c.name}</span>
                <span className="block truncate text-[12px] text-fg-muted" title={c.dynamic_features}>
                  {c.dynamic_features || c.static_features}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function Board({ story, act, pending, canRedraw, preview, rendering }: { story: Story; act: Act; pending: Pending; canRedraw: boolean; preview?: boolean; rendering?: boolean }) {
  const [editing, setEditing] = useState<StoryShot | null>(null);
  const [text, setText] = useState("");
  const wide = story.aspect === "16:9";
  if (story.shots.length === 0) {
    return (
      <div className={cx("grid gap-3", wide ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4")}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="ds-skeleton rounded-ds-md" style={{ aspectRatio: RATIO[story.aspect] }} />
        ))}
      </div>
    );
  }
  return (
    <>
      <ol className={cx("grid gap-x-3 gap-y-5", wide ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4")}>
        {story.shots.map((shot) => (
          <li key={shot.idx} className="group min-w-0 space-y-2">
            <div className="relative overflow-hidden rounded-ds-md border border-hairline bg-surface-2" style={{ aspectRatio: RATIO[story.aspect] }}>
              {shot.frame_ready ? <Img key={shot.frame_rev} src={storyMedia.frame(story.id, shot)} alt={`Shot ${shot.idx + 1}: ${shot.first_frame}`} preview={preview} seed={`${story.id}-${shot.idx}-${shot.frame_rev}`} /> : <Skeleton className="absolute inset-0 rounded-none" />}
              {rendering && (
                <span className="absolute left-2 top-2 rounded-ds-sm bg-overlay shadow-ds-float">
                  <StatusBadge tone={shot.clip_ready ? "positive" : "neutral"}>{shot.clip_ready ? "Clip ready" : story.status === "failed" ? "Not rendered" : "Queued"}</StatusBadge>
                </span>
              )}
              {canRedraw && shot.frame_ready && (
                <span className="absolute right-1.5 top-1.5 flex gap-1 rounded-ds-sm bg-overlay/90 p-0.5 opacity-100 shadow-ds-float transition-opacity duration-150 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  <IconButton label={`Redraw shot ${shot.idx + 1}`} onClick={() => act("redraw", () => storyApi.redraw(story.id, shot.idx))} disabled={pending.busy !== null}>
                    <RefreshCw />
                  </IconButton>
                  <IconButton
                    label={`Edit shot ${shot.idx + 1}`}
                    onClick={() => {
                      setText(shot.first_frame);
                      setEditing(shot);
                    }}
                  >
                    <Pencil />
                  </IconButton>
                </span>
              )}
            </div>
            <div className="space-y-0.5 px-0.5">
              <p className="text-[12px] text-fg-faint tabular">
                Shot {shot.idx + 1} · {shot.duration_sec}s
              </p>
              <p className="line-clamp-2 text-[12.5px] text-fg-muted" title={shot.motion}>
                {shot.motion || shot.visual}
              </p>
              {shot.narration && <p className="line-clamp-2 text-[12.5px] text-fg">“{shot.narration}”</p>}
            </div>
          </li>
        ))}
      </ol>
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Shot ${editing.idx + 1}` : "Shot"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={pending.busy === "redraw"}
              disabled={text.trim().length < 3 || pending.busy !== null}
              onClick={() => editing && act("redraw", () => storyApi.redraw(story.id, editing.idx, text)).then((ok) => ok && setEditing(null))}
            >
              Redraw this shot
            </Button>
          </>
        }
      >
        <Field label="What the first frame shows" hint="Only this shot is redrawn. Characters keep their reference look.">
          <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
        </Field>
      </Modal>
    </>
  );
}

/** A frame or portrait that settles in: a soft blur and fade once the image has loaded, over the skeleton. */
function Img({ src, alt, preview, seed }: { src: string; alt: string; preview?: boolean; seed: string }) {
  const [loaded, setLoaded] = useState(false);
  if (preview) return <span role="img" aria-label={alt} className="absolute inset-0" style={{ background: cssFallback(paletteFor(seed)) } as CSSProperties} />;
  return (
    <>
      {!loaded && <Skeleton className="absolute inset-0 rounded-none" />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        className={cx("absolute inset-0 size-full object-cover transition-[opacity,filter] duration-[var(--ds-dur-slow)] ease-[var(--ds-ease-out)]", loaded ? "opacity-100 blur-0" : "opacity-0 blur-[2px]")}
      />
    </>
  );
}

/* ------------------------------------------------------------ 3 · render */

function RenderStep({ story, act, pending, preview }: { story: Story; act: Act; pending: Pending; preview?: boolean }) {
  const canApprove = useAllowed("spend:approve");
  const [approved, setApproved] = useState(false);
  const { clips, shots } = story.progress;
  if (story.status === "awaiting_approval") {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
        <PlanCard
          title="Render this story video"
          icon={<Film className="size-4" />}
          meta={`about ${formatUsd(story.estimate_usd)}`}
          steps={[
            { label: `${story.shots.length} shots, ${story.shots.reduce((a, s) => a + s.duration_sec, 0)} seconds in all`, state: "done" },
            { label: `Estimated ${formatUsd(story.estimate_usd)}, above your approval line: waiting for a person` },
            { label: "Render each shot, then cut them into one video" },
          ]}
          approveLabel="Approve & Render"
          approving={pending.busy === "approve"}
          dismissing={pending.busy === "decline"}
          approved={approved}
          onApprove={() => act("approve", () => storyApi.approve(story.id)).then((ok) => ok && setApproved(true))}
          onDismiss={() => act("decline", () => storyApi.decline(story.id))}
          blocked={canApprove ? undefined : "Owners, admins and marketers approve spend."}
        />
        <Notice error={pending.error} />
        </div>
        <Board story={story} act={act} pending={pending} canRedraw={false} preview={preview} />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {story.status === "rendering" && <Working>{`Rendering shots · ${clips} of ${shots}`}</Working>}
        <Meter value={shots ? (clips / shots) * 100 : 0} label={`${clips} of ${shots} shots rendered`} />
      </div>
      <Board story={story} act={act} pending={pending} canRedraw={false} preview={preview} rendering />
    </div>
  );
}

/* ------------------------------------------------------------ 4 · video */

function VideoStep({ story, act, pending, canMake, preview }: { story: Story; act: Act; pending: Pending; canMake: boolean; preview?: boolean }) {
  const src = storyMedia.video(story.id, story.revision);
  return (
    <div className="space-y-8">
      <div className={cx("mx-auto overflow-hidden rounded-ds-lg border border-hairline bg-surface-2", story.aspect === "16:9" ? "max-w-full" : story.aspect === "1:1" ? "max-w-md" : "max-w-xs")} style={{ aspectRatio: RATIO[story.aspect] }}>
        {preview ? <span role="img" aria-label="Final video" className="block size-full" style={{ background: cssFallback(paletteFor(story.id)) }} /> : <video src={src} controls playsInline preload="metadata" className="size-full bg-surface-3 object-contain" />}
      </div>
      <ActionBar
        error={pending.error}
        actions={
          <ButtonLink href={src} variant="primary" download>
            Download
          </ButtonLink>
        }
      >
        {story.shots.length} shots · {formatUsd(story.spent_usd)} spent
      </ActionBar>
      <Section title="Storyboard">
        <Board story={story} act={act} pending={pending} canRedraw={canMake} preview={preview} />
      </Section>
    </div>
  );
}
