"use client";

// Single-page form for editing an existing niche. We don't reuse the
// 3-step wizard from /onboarding: when editing you want all fields
// visible at once for quick scanning. The server action's payload
// shape is identical to onboarding's submission.

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
import { PLATFORMS, QUALITIES, RESOLUTIONS, type Niche } from "@/lib/types";

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

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="niche_id" value={niche.id} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identity</CardTitle>
          <CardDescription>What this channel is and who it&apos;s for.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Labelled label="Title">
            <Input name="title" defaultValue={niche.title} required />
          </Labelled>
          <Labelled label="Description">
            <Textarea
              name="description"
              defaultValue={niche.description}
              rows={3}
              required
            />
          </Labelled>
          <Labelled label="Target audience">
            <Input
              name="target_audience"
              defaultValue={niche.target_audience}
              required
            />
          </Labelled>
          <Labelled
            label="Hashtags"
            hint="Comma-separated, without #"
          >
            <Input
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Creative</CardTitle>
          <CardDescription>Style and provider behavior.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Labelled label="Visual style">
            <Textarea
              name="visual_style"
              defaultValue={niche.visual_style}
              rows={3}
              required
            />
          </Labelled>
          <div className="grid gap-4 sm:grid-cols-3">
            <Labelled label="Voice">
              <Select name="voice" defaultValue={niche.voice}>
                <SelectTrigger>
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
            <Labelled label="Duration (s)">
              <Input
                name="target_duration_sec"
                type="number"
                min={15}
                max={90}
                defaultValue={niche.target_duration_sec}
                required
              />
            </Labelled>
            <Labelled label="Scenes">
              <Input
                name="scene_count"
                type="number"
                min={2}
                max={12}
                defaultValue={niche.scene_count}
                required
              />
            </Labelled>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Labelled label="Image quality">
              <Select
                name="image_quality"
                defaultValue={niche.image_quality}
              >
                <SelectTrigger>
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
            <Labelled label="Video resolution">
              <Select
                name="video_resolution"
                defaultValue={niche.video_resolution}
              >
                <SelectTrigger>
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
            <Labelled label="Max scene (s)">
              <Input
                name="scene_max_duration_sec"
                type="number"
                min={1}
                max={15}
                defaultValue={niche.scene_max_duration_sec}
                required
              />
            </Labelled>
          </div>

          <Labelled
            label="TTS style directions"
            hint="Optional, passed verbatim"
          >
            <Input
              name="tts_style_directions"
              defaultValue={niche.tts_style_directions ?? ""}
              placeholder="calm, conspiratorial narrator with deliberate pauses"
            />
          </Labelled>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Schedule &amp; cap</CardTitle>
          <CardDescription>When and how often to post.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Labelled label="Hour (0-23)">
              <Input
                name="posting_hour"
                type="number"
                min={0}
                max={23}
                defaultValue={window.hour}
                required
              />
            </Labelled>
            <Labelled label="Minute">
              <Input
                name="posting_minute"
                type="number"
                min={0}
                max={59}
                defaultValue={window.minute}
                required
              />
            </Labelled>
            <Labelled label="Timezone">
              <Input name="tz" defaultValue={window.tz} required />
            </Labelled>
          </div>

          <Labelled label="Platforms">
            <div className="grid grid-cols-3 gap-2">
              {PLATFORMS.map((p) => (
                <label
                  key={p}
                  className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm capitalize hover:bg-accent/30"
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
          </Labelled>

          <Labelled label="Daily spend cap (USD)">
            <Input
              name="daily_spend_cap_usd"
              type="number"
              step="0.01"
              min={0.5}
              defaultValue={niche.daily_spend_cap_usd}
              required
            />
          </Labelled>
        </CardContent>
      </Card>

      {state.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}

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

function Labelled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
