"use client";

// The scheduled-post calendar.
//
// The thing this surface has to get right is that ONE POST IS N DELIVERIES.
// Each platform variant carries its own status, provider post id and error,
// which is why `partial` exists as a parent status at all. So every post
// renders its variants individually - a green parent badge must never hide a
// failed Instagram row.
//
// Polling: only while something is genuinely in flight (`dispatching`).
// A calendar full of future posts has nothing to poll for.

import * as React from "react";
import useSWR from "swr";
import {
  AlertCircle,
  CalendarClock,
  Check,
  Clock,
  Loader2,
  Pencil,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  canDelete,
  canPublishNow,
  dayKeyInZone,
  deleteScheduledPost,
  formatInZone,
  isConflict,
  platformLabel,
  publishNow,
  scheduledErrorMessage,
  scheduledKeys,
  scheduledPostsFetcher,
  updateScheduledPost,
  utcIsoToWallClock,
  wallClockToUtcIso,
  type PlatformVariant,
  type PostStatus,
  type RecurringSlot,
  type ScheduledPost,
  type VariantStatus,
} from "@/lib/scheduled-client";
import { CsvImport } from "./CsvImport";
import { PostComposer } from "./PostComposer";
import { RecurringSlots } from "./RecurringSlots";

const POLL_MS = 5_000;

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "scheduled", label: "Scheduled" },
  { value: "due", label: "Due now" },
  { value: "dispatching", label: "Publishing" },
  { value: "posted", label: "Posted" },
  { value: "partial", label: "Partial" },
  { value: "failed", label: "Failed" },
];

const POST_STATUS_LABELS: Record<PostStatus, string> = {
  scheduled: "Scheduled",
  dispatching: "Publishing",
  posted: "Posted",
  partial: "Partly posted",
  failed: "Failed",
};

const POST_STATUS_CLASSES: Record<PostStatus, string> = {
  scheduled: "border-border bg-muted/40 text-muted-foreground",
  dispatching: "border-primary/30 bg-primary/10 text-primary",
  posted: "border-success/25 bg-success/10 text-success",
  partial: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
};

const VARIANT_STATUS_CLASSES: Record<VariantStatus, string> = {
  pending: "border-border bg-muted/40 text-muted-foreground",
  dispatching: "border-primary/30 bg-primary/10 text-primary",
  posted: "border-success/25 bg-success/10 text-success",
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
};

const VARIANT_STATUS_LABELS: Record<VariantStatus, string> = {
  pending: "Waiting",
  dispatching: "Sending",
  posted: "Posted",
  failed: "Failed",
};

function VariantRow({ variant }: { variant: PlatformVariant }) {
  const Icon =
    variant.status === "posted"
      ? Check
      : variant.status === "failed"
        ? X
        : variant.status === "dispatching"
          ? Loader2
          : Clock;
  return (
    <li className="flex flex-wrap items-center gap-2 border-t px-3 py-2 text-sm">
      <span className="w-28 shrink-0 font-medium">{platformLabel(variant.platform)}</span>
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
          VARIANT_STATUS_CLASSES[variant.status],
        )}
      >
        <Icon
          className={cn("size-3", variant.status === "dispatching" && "animate-spin")}
          aria-hidden
        />
        {VARIANT_STATUS_LABELS[variant.status]}
      </span>
      <span className="text-xs text-muted-foreground">
        {variant.content === null ? "default copy" : "custom copy"}
      </span>
      {variant.provider_post_id ? (
        <code className="font-mono text-[11px] text-muted-foreground">
          {variant.provider_post_id}
        </code>
      ) : null}
      {variant.error ? (
        <span className="w-full text-xs text-destructive sm:w-auto sm:flex-1">
          {variant.error}
        </span>
      ) : null}
      {variant.dispatched_at ? (
        <span className="ml-auto text-xs text-muted-foreground">
          {new Date(variant.dispatched_at).toLocaleString()}
        </span>
      ) : null}
    </li>
  );
}

function PostCard({
  post,
  onChanged,
  onRemoved,
}: {
  post: ScheduledPost;
  onChanged: (p: ScheduledPost) => void;
  onRemoved: (id: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [when, setWhen] = React.useState(() =>
    utcIsoToWallClock(post.scheduled_at, post.timezone),
  );
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    setWhen(utcIsoToWallClock(post.scheduled_at, post.timezone));
  }, [post.scheduled_at, post.timezone]);

  const posted = post.variants.filter((v) => v.status === "posted").length;
  const failed = post.variants.filter((v) => v.status === "failed").length;
  const editable = post.status !== "dispatching" && post.status !== "posted";

  async function reschedule() {
    if (busy) return;
    setBusy("move");
    try {
      const saved = await updateScheduledPost(post.id, {
        scheduled_at: wallClockToUtcIso(when, post.timezone),
      });
      onChanged(saved);
      toast.success("Rescheduled");
    } catch (err) {
      toast.error(scheduledErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function handlePublishNow() {
    if (busy) return;
    setBusy("publish");
    try {
      await publishNow(post.id);
      // 202: the claim already happened synchronously, so the row is
      // `dispatching` right now - reflect that immediately and let the poll
      // carry it to its terminal state.
      onChanged({ ...post, status: "dispatching" });
      toast.success("Publishing now");
    } catch (err) {
      toast.error(
        isConflict(err)
          ? `${scheduledErrorMessage(err)} - it may already be on its way.`
          : scheduledErrorMessage(err),
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (busy) return;
    setBusy("delete");
    try {
      await deleteScheduledPost(post.id);
      onRemoved(post.id);
      toast.success("Post deleted");
    } catch (err) {
      toast.error(
        isConflict(err)
          ? `${scheduledErrorMessage(err)} Deleting it would destroy the only record of what went out.`
          : scheduledErrorMessage(err),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="gap-0 py-0">
      <div className="space-y-3 px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
              POST_STATUS_CLASSES[post.status],
            )}
          >
            {post.status === "dispatching" ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : null}
            {POST_STATUS_LABELS[post.status]}
          </span>
          <span className="text-sm font-medium tabular-nums">
            {formatInZone(post.scheduled_at, post.timezone)}
          </span>
          <span className="text-xs text-muted-foreground">{post.timezone}</span>
          {post.source !== "manual" ? (
            <Badge variant="secondary" className="text-[10px]">
              {post.source}
            </Badge>
          ) : null}
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {posted}/{post.variants.length} delivered
          </span>
        </div>

        {post.status === "partial" ? (
          <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            This post went live on {posted} platform{posted === 1 ? "" : "s"} and
            failed on {failed}. Editing and re-arming only retries the platforms
            that failed - the ones that posted are never sent twice.
          </p>
        ) : null}

        {post.error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {post.error}
          </p>
        ) : null}

        {post.content ? (
          <p className="whitespace-pre-wrap text-sm">{post.content}</p>
        ) : (
          <p className="text-sm italic text-muted-foreground">
            No default copy - each platform posts its own.
          </p>
        )}

        {post.media_urls.length > 0 ? (
          <ul className="space-y-0.5">
            {post.media_urls.map((u) => (
              <li key={u} className="truncate text-xs text-muted-foreground">
                <a
                  href={u}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline-offset-2 hover:underline"
                >
                  {u}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <ul className="list-none border-t-0">
        {post.variants.map((v) => (
          <VariantRow key={v.id ?? v.platform} variant={v} />
        ))}
      </ul>

      <div className="flex flex-wrap items-end gap-2 border-t px-4 py-3">
        {editable ? (
          <>
            <div className="space-y-1">
              <Label htmlFor={`move-${post.id}`} className="text-xs">
                Reschedule ({post.timezone})
              </Label>
              <Input
                id={`move-${post.id}`}
                type="datetime-local"
                className="h-8 w-auto text-xs"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={
                busy !== null || when === utcIsoToWallClock(post.scheduled_at, post.timezone)
              }
              onClick={() => void reschedule()}
            >
              {busy === "move" ? <Loader2 className="animate-spin" aria-hidden /> : (
                <CalendarClock aria-hidden />
              )}
              Move
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => setEditing((v) => !v)}
            >
              <Pencil aria-hidden />
              {editing ? "Close editor" : "Edit"}
            </Button>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            {post.status === "dispatching"
              ? "Publishing right now - it may already be mid-flight to a real account, so it cannot be edited."
              : "Already published. The copy that went out is kept as the record of it."}
          </p>
        )}
        <span className="ml-auto flex gap-2">
          {canPublishNow(post) ? (
            <Button size="sm" disabled={busy !== null} onClick={() => void handlePublishNow()}>
              {busy === "publish" ? <Loader2 className="animate-spin" aria-hidden /> : (
                <Send aria-hidden />
              )}
              Publish now
            </Button>
          ) : null}
          {canDelete(post) ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={busy !== null}
              onClick={() => void handleDelete()}
            >
              {busy === "delete" ? <Loader2 className="animate-spin" aria-hidden /> : (
                <Trash2 aria-hidden />
              )}
              Delete
            </Button>
          ) : null}
        </span>
      </div>

      {editing && editable ? (
        <div className="border-t px-4 py-4">
          <PostComposer
            post={post}
            onDone={(saved) => {
              onChanged(saved);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : null}
    </Card>
  );
}

export function ScheduledClient({
  initialPosts,
  initialSlots,
}: {
  initialPosts: ScheduledPost[];
  initialSlots: RecurringSlot[];
}) {
  const [status, setStatus] = React.useState("");
  const key = scheduledKeys.list({ status: status || undefined, limit: 200 });

  const { data, mutate } = useSWR<ScheduledPost[]>(key, scheduledPostsFetcher, {
    fallbackData: status === "" ? initialPosts : undefined,
    // Only poll while a dispatch is genuinely in flight.
    refreshInterval: (rows) =>
      (rows ?? []).some((p) => p.status === "dispatching") ? POLL_MS : 0,
  });
  const posts = data ?? [];

  const groups = React.useMemo(() => {
    const map = new Map<string, ScheduledPost[]>();
    for (const post of posts) {
      const day = dayKeyInZone(post.scheduled_at, post.timezone);
      const bucket = map.get(day);
      if (bucket) bucket.push(post);
      else map.set(day, [post]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [posts]);

  function applyChange(saved: ScheduledPost) {
    void mutate(
      (rows) => (rows ?? []).map((p) => (p.id === saved.id ? saved : p)),
      { revalidate: true },
    );
  }

  function applyRemoval(id: string) {
    void mutate((rows) => (rows ?? []).filter((p) => p.id !== id), { revalidate: true });
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
          Publishing
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Scheduled posts</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Hand-authored posts with per-platform copy. One post fans out to every
          platform you pick, and each delivery succeeds or fails on its own - so
          a failure on one never re-posts the others.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">New post</CardTitle>
              <CardDescription>
                Write once, override per platform where it matters.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PostComposer onDone={() => void mutate()} />
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Calendar
            </h2>
            <span className="ml-auto flex flex-wrap gap-1">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.value || "all"}
                  type="button"
                  aria-pressed={status === f.value}
                  onClick={() => setStatus(f.value)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    status === f.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </span>
          </div>

          {posts.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <h3 className="text-base font-semibold">Nothing here</h3>
                <p className="max-w-sm text-sm text-muted-foreground">
                  {status
                    ? "No posts match this filter."
                    : "Schedule your first post above, or import a whole week from CSV."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {groups.map(([day, dayPosts]) => (
                <div key={day} className="space-y-3">
                  <h3 className="text-sm font-medium text-muted-foreground">
                    {new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </h3>
                  {dayPosts.map((post) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      onChanged={applyChange}
                      onRemoved={applyRemoval}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <RecurringSlots initial={initialSlots} />
          <CsvImport onImported={() => void mutate()} />
        </div>
      </div>
    </div>
  );
}
