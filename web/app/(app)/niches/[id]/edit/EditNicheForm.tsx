"use client";

// Single-page form for editing an existing niche. We don't reuse the
// 3-step wizard from /onboarding: when editing you want all fields
// visible at once for quick scanning. The server action's payload
// shape is identical to onboarding's submission.
//
// Fields stay uncontrolled (defaultValue + name) so the native
// <form action={formAction}> serialization is unchanged. A thin layer
// of local state mirrors the five cost-relevant inputs purely to drive
// the live "estimated cost per video" readout — it never gates submit.

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { updateNicheAction } from "@/lib/actions";
import { EMPTY_STATE, type ActionState } from "@/lib/action-state";
import { estimateVideoCostUsd } from "@/lib/cost-estimator";
import { formatUsd } from "@/lib/format";
import {
  PLATFORMS,
  QUALITIES,
  RESOLUTIONS,
  type ImageQuality,
  type Niche,
  type VideoResolution,
} from "@/lib/types";

const VOICES = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
  "ash",
  "sage",
  "coral",
];

interface CostInputs {
  scene_count: number;
  image_quality: ImageQuality;
  video_resolution: VideoResolution;
  scene_max_duration_sec: number;
  target_duration_sec: number;
}

export function EditNicheForm({ niche }: { niche: Niche }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    updateNicheAction,
    EMPTY_STATE,
  );

  React.useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  const window = niche.posting_windows[0] ?? {
    hour: 9,
    minute: 0,
    tz: "America/Los_Angeles",
  };

  // Live cost-estimate mirror. Uncontrolled inputs still own the truth
  // for submission; this only feeds the readout.
  const [cost, setCost] = React.useState<CostInputs>({
    scene_count: niche.scene_count,
    image_quality: niche.image_quality,
    video_resolution: niche.video_resolution,
    scene_max_duration_sec: niche.scene_max_duration_sec,
    target_duration_sec: niche.target_duration_sec,
  });
  const patchCost = (patch: Partial<CostInputs>) =>
    setCost((c) => ({ ...c, ...patch }));

  const breakdown = estimateVideoCostUsd({
    scene_count: Number(cost.scene_count) || 1,
    image_quality: cost.image_quality,
    video_resolution: cost.video_resolution,
    scene_max_duration_sec: Number(cost.scene_max_duration_sec) || 1,
    target_duration_sec: Number(cost.target_duration_sec) || 1,
  });

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="niche_id" value={niche.id} />

      <SectionCard
        kicker="Identity"
        title="Who this is for"
        description="What this channel is and who it's for."
      >
        <Labelled label="Title" htmlFor="niche-title">
          <Input id="niche-title" name="title" defaultValue={niche.title} required />
        </Labelled>
        <Labelled label="Description" htmlFor="niche-description">
          <Textarea
            id="niche-description"
            name="description"
            defaultValue={niche.description}
            rows={3}
            required
          />
        </Labelled>
        <Labelled label="Target audience" htmlFor="niche-target_audience">
          <Input
            id="niche-target_audience"
            name="target_audience"
            defaultValue={niche.target_audience}
            required
          />
        </Labelled>
        <Labelled
          label="Hashtags"
          hint="Comma-separated, without #"
          htmlFor="niche-hashtags"
        >
          <Input
            id="niche-hashtags"
            name="hashtags"
            defaultValue={niche.hashtags.join(", ")}
            placeholder="econ, macro, fed"
          />
          {niche.hashtags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-2">
              {niche.hashtags.map((t) => (
                <Badge key={t} variant="secondary" className="font-normal">
                  #{t}
                </Badge>
              ))}
            </div>
          )}
        </Labelled>
      </SectionCard>

      <SectionCard
        kicker="Creative"
        title="Look & voice"
        description="Style and provider behavior."
      >
        <Labelled label="Visual style" htmlFor="niche-visual_style">
          <Textarea
            id="niche-visual_style"
            name="visual_style"
            defaultValue={niche.visual_style}
            rows={3}
            required
          />
        </Labelled>
        <div className="grid gap-4 sm:grid-cols-3">
          <Labelled label="Voice" htmlFor="niche-voice">
            <Select name="voice" defaultValue={niche.voice}>
              <SelectTrigger id="niche-voice">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VOICES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Labelled>
          <Labelled label="Duration (s)" htmlFor="niche-target_duration_sec">
            <Input
              id="niche-target_duration_sec"
              name="target_duration_sec"
              type="number"
              min={15}
              max={90}
              defaultValue={niche.target_duration_sec}
              onChange={(e) =>
                patchCost({ target_duration_sec: Number(e.target.value) })
              }
              required
            />
          </Labelled>
          <Labelled label="Scenes" htmlFor="niche-scene_count">
            <Input
              id="niche-scene_count"
              name="scene_count"
              type="number"
              min={2}
              max={12}
              defaultValue={niche.scene_count}
              onChange={(e) =>
                patchCost({ scene_count: Number(e.target.value) })
              }
              required
            />
          </Labelled>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Labelled label="Image quality" htmlFor="niche-image_quality">
            <Select
              name="image_quality"
              defaultValue={niche.image_quality}
              onValueChange={(v) =>
                patchCost({ image_quality: v as ImageQuality })
              }
            >
              <SelectTrigger id="niche-image_quality">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUALITIES.map((q) => (
                  <SelectItem key={q} value={q}>
                    {q}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Labelled>
          <Labelled label="Video resolution" htmlFor="niche-video_resolution">
            <Select
              name="video_resolution"
              defaultValue={niche.video_resolution}
              onValueChange={(v) =>
                patchCost({ video_resolution: v as VideoResolution })
              }
            >
              <SelectTrigger id="niche-video_resolution">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOLUTIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Labelled>
          <Labelled label="Max scene (s)" htmlFor="niche-scene_max_duration_sec">
            <Input
              id="niche-scene_max_duration_sec"
              name="scene_max_duration_sec"
              type="number"
              min={1}
              max={15}
              defaultValue={niche.scene_max_duration_sec}
              onChange={(e) =>
                patchCost({ scene_max_duration_sec: Number(e.target.value) })
              }
              required
            />
          </Labelled>
        </div>

        <Labelled
          label="TTS style directions"
          hint="Optional, passed verbatim"
          htmlFor="niche-tts_style_directions"
        >
          <Input
            id="niche-tts_style_directions"
            name="tts_style_directions"
            defaultValue={niche.tts_style_directions ?? ""}
            placeholder="calm, conspiratorial narrator with deliberate pauses"
          />
        </Labelled>

        {/* Live estimate — mirrors the onboarding wizard's readout. */}
        <Card className="border-border/60 bg-muted/30">
          <CardContent className="flex items-baseline justify-between p-4">
            <span className="text-sm text-muted-foreground">
              Estimated cost per video
            </span>
            <span className="font-mono text-lg font-semibold tabular-nums">
              {formatUsd(breakdown.total)}
            </span>
          </CardContent>
        </Card>
      </SectionCard>

      <SectionCard
        kicker="Schedule & cap"
        title="When & how much"
        description="When and how often to post."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Labelled label="Hour (0-23)" htmlFor="niche-posting_hour">
            <Input
              id="niche-posting_hour"
              name="posting_hour"
              type="number"
              min={0}
              max={23}
              defaultValue={window.hour}
              required
            />
          </Labelled>
          <Labelled label="Minute" htmlFor="niche-posting_minute">
            <Input
              id="niche-posting_minute"
              name="posting_minute"
              type="number"
              min={0}
              max={59}
              defaultValue={window.minute}
              required
            />
          </Labelled>
          <Labelled label="Timezone" htmlFor="niche-tz">
            <Input id="niche-tz" name="tz" defaultValue={window.tz} required />
          </Labelled>
        </div>

        {/* Checkbox group: a single htmlFor can't point at many inputs,
            so associate the "Platforms" heading via role=group +
            aria-labelledby instead. */}
        <div
          className="space-y-2"
          role="group"
          aria-labelledby="niche-platforms-label"
        >
          <Label id="niche-platforms-label">Platforms</Label>
          <div className="grid grid-cols-3 gap-2">
            {PLATFORMS.map((p) => (
              <label
                key={p}
                className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm capitalize transition-colors hover:bg-accent/30"
              >
                {/* Native checkbox so the value actually serializes in
                    the form data; Radix's Checkbox is a button. */}
                <input
                  type="checkbox"
                  name="platforms"
                  value={p}
                  defaultChecked={niche.platforms.includes(p)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                {p}
              </label>
            ))}
          </div>
        </div>

        <Labelled label="Daily spend cap (USD)" htmlFor="niche-daily_spend_cap_usd">
          <Input
            id="niche-daily_spend_cap_usd"
            name="daily_spend_cap_usd"
            type="number"
            step="0.01"
            min={0.5}
            defaultValue={niche.daily_spend_cap_usd}
            required
          />
        </Labelled>

        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-input p-4 transition-colors hover:border-brand/30">
          <input
            className="mt-0.5 size-4 accent-[hsl(var(--brand))]"
            defaultChecked={niche.approve_before_post}
            name="approve_before_post"
            type="checkbox"
          />
          <span>
            <span className="block text-sm font-medium">
              Review each video before it posts
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Rendered videos wait for your approval in the queue instead of
              posting on schedule.
            </span>
          </span>
        </label>
      </SectionCard>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <div className="flex justify-end gap-2">
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save changes"}
    </Button>
  );
}

function SectionCard({
  kicker,
  title,
  description,
  children,
}: {
  kicker: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
          {kicker}
        </p>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function Labelled({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
