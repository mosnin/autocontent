"use client";

// Compose or edit one scheduled post. The same form serves both because the
// PATCH body is a strict subset of the POST body — a separate edit form would
// be two places to keep the variant rules correct.
//
// Time handling: `scheduled_at` is UTC on the wire, but a human authors "09:00
// on the 9th" in a named zone. The <input type="datetime-local"> is therefore
// read as wall-clock time *in the selected IANA zone* and converted with
// Intl (see lib/scheduled-client.ts) — never with the browser's own offset,
// which would silently shift a post authored for another region.

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/square/ui/button";
import { Input } from "@/components/square/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  MAX_CONTENT_CHARS,
  MAX_MEDIA_PER_POST,
  PLATFORMS,
  browserTimezone,
  createScheduledPost,
  platformLabel,
  scheduledErrorMessage,
  timezoneOptions,
  updateScheduledPost,
  utcIsoToWallClock,
  wallClockToUtcIso,
  type ScheduledPost,
  type VariantOverride,
} from "@/lib/scheduled-client";

/** `datetime-local` value for "an hour from now", rounded to the next 15
 *  minutes, in the given zone. */
function defaultWhen(tz: string): string {
  const t = new Date(Date.now() + 60 * 60 * 1000);
  t.setMinutes(Math.ceil(t.getMinutes() / 15) * 15, 0, 0);
  return utcIsoToWallClock(t.toISOString(), tz);
}

export function PostComposer({
  post,
  onDone,
  onCancel,
}: {
  /** Present = edit mode. */
  post?: ScheduledPost;
  onDone: (post: ScheduledPost) => void;
  onCancel?: () => void;
}) {
  const editing = Boolean(post);
  const [timezone, setTimezone] = React.useState(post?.timezone ?? browserTimezone());
  const [content, setContent] = React.useState(post?.content ?? "");
  const [mediaText, setMediaText] = React.useState((post?.media_urls ?? []).join("\n"));
  const [platforms, setPlatforms] = React.useState<string[]>(
    post ? post.variants.map((v) => v.platform) : [],
  );
  const [when, setWhen] = React.useState(() =>
    post
      ? utcIsoToWallClock(post.scheduled_at, post.timezone)
      : // No post in this branch, so there is no stored zone to prefer —
        // a new post is always composed in the composer's own timezone.
        defaultWhen(browserTimezone()),
  );
  const [overrides, setOverrides] = React.useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const v of post?.variants ?? []) if (v.content !== null) out[v.platform] = v.content;
    return out;
  });
  const [saving, setSaving] = React.useState(false);

  const zones = React.useMemo(() => timezoneOptions(timezone), [timezone]);
  const mediaUrls = mediaText
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  function togglePlatform(name: string) {
    setPlatforms((prev) =>
      prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name],
    );
    // A variant for a platform we aren't posting to is a 422 server-side, so
    // drop the override the moment the platform is unselected.
    setOverrides((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }

  function toggleOverride(name: string) {
    setOverrides((prev) => {
      const next = { ...prev };
      if (name in next) delete next[name];
      else next[name] = content;
      return next;
    });
  }

  /** Mirrors ScheduledPostCreate._coherent: every targeted platform must end
   *  up with something to post. */
  function validate(): string | null {
    if (platforms.length === 0) return "Pick at least one platform.";
    if (!when) return "Pick a date and time.";
    if (mediaUrls.length > MAX_MEDIA_PER_POST)
      return `At most ${MAX_MEDIA_PER_POST} media URLs per post.`;
    for (const u of mediaUrls) {
      if (!/^https?:\/\//.test(u)) return `Media URL must be http(s): ${u}`;
    }
    if (content.trim() || mediaUrls.length > 0) return null;
    for (const p of platforms) {
      if (!(overrides[p] ?? "").trim())
        return `Add copy or media — ${platformLabel(p)} has nothing to post.`;
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    const variants: Record<string, VariantOverride> = {};
    for (const [platform, copy] of Object.entries(overrides)) {
      variants[platform] = { content: copy };
    }
    const body = {
      content,
      media_urls: mediaUrls,
      platforms,
      scheduled_at: wallClockToUtcIso(when, timezone),
      timezone,
      variants,
    };
    setSaving(true);
    try {
      const saved = post
        ? await updateScheduledPost(post.id, body)
        : await createScheduledPost(body);
      toast.success(editing ? "Post updated" : "Post scheduled");
      if (!editing) {
        setContent("");
        setMediaText("");
        setPlatforms([]);
        setOverrides({});
        setWhen(defaultWhen(timezone));
      }
      onDone(saved);
    } catch (err) {
      toast.error(scheduledErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="post-content">Post copy</Label>
          <span
            className={cn(
              "font-mono text-xs tabular-nums text-muted-foreground",
              content.length > MAX_CONTENT_CHARS && "text-destructive",
            )}
          >
            {content.length} / {MAX_CONTENT_CHARS}
          </span>
        </div>
        <Textarea
          id="post-content"
          name="content"
          rows={4}
          value={content}
          maxLength={MAX_CONTENT_CHARS}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What goes out by default on every platform…"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="post-media">Media URLs</Label>
        <Textarea
          id="post-media"
          name="media_urls"
          rows={2}
          value={mediaText}
          onChange={(e) => setMediaText(e.target.value)}
          placeholder="https://… (one per line, up to 10)"
        />
        <p className="text-xs text-muted-foreground">
          {mediaUrls.length}/{MAX_MEDIA_PER_POST} media attached. Must be public
          http(s) URLs — the platforms fetch them at publish time.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Platforms</Label>
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((name) => {
            const on = platforms.includes(name);
            return (
              <button
                key={name}
                type="button"
                aria-pressed={on}
                onClick={() => togglePlatform(name)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-transparent text-muted-foreground hover:bg-muted",
                )}
              >
                {platformLabel(name)}
              </button>
            );
          })}
        </div>
      </div>

      {platforms.length > 0 ? (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-sm font-medium">Per-platform copy</p>
          <p className="text-xs text-muted-foreground">
            Leave a platform alone and it posts the default copy above. Override it
            and only that platform changes — each one is dispatched separately, so
            they succeed and fail independently.
          </p>
          <div className="space-y-3">
            {platforms.map((name) => {
              const on = name in overrides;
              return (
                <div key={name} className="space-y-1.5">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={on}
                      onChange={() => toggleOverride(name)}
                    />
                    <span className="font-medium">{platformLabel(name)}</span>
                    <span className="text-xs text-muted-foreground">
                      {on ? "custom copy" : "inherits default"}
                    </span>
                  </label>
                  {on ? (
                    <Textarea
                      rows={3}
                      value={overrides[name]}
                      maxLength={MAX_CONTENT_CHARS}
                      onChange={(e) =>
                        setOverrides((prev) => ({ ...prev, [name]: e.target.value }))
                      }
                      placeholder={`Copy for ${platformLabel(name)}`}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="post-when">Date &amp; time</Label>
          <Input
            id="post-when"
            name="scheduled_at"
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="post-tz">Timezone</Label>
          <select
            id="post-tz"
            name="timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="border-input dark:bg-input/30 h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Read as wall-clock time in {timezone}. Recurring slots keep their local
        hour across daylight-saving changes rather than drifting.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {editing ? "Save changes" : "Schedule post"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
