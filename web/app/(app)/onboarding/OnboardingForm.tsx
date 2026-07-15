"use client";

// Three-step onboarding wizard.
//
// React-hook-form holds the full payload across all three steps;
// each step's "Next" button validates only its own slice via
// `form.trigger(fields)`. The final step calls `createNicheAction`
// directly (no <form action={}> submission) so we can pre-validate
// the entire payload before the server round trip.

import * as React from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useFormContext } from "react-hook-form";
import { Loader2, Play, Square, X } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createNicheAction } from "@/lib/actions";
import { estimateVideoCostUsd } from "@/lib/cost-estimator";
import { formatUsd } from "@/lib/format";
import { PLATFORMS, QUALITIES, RESOLUTIONS } from "@/lib/types";
import { cn } from "@/lib/utils";

const VOICE_OPTIONS = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
  "ash",
  "sage",
  "coral",
] as const;

const STYLE_EXAMPLES = [
  "claymation econ teacher",
  "horror short narrator",
  "70s film grain",
];

// Shared presentation primitives so all three steps read as one form.
// Sub-label above a grouped cluster of controls.
function StepKicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
      {children}
    </p>
  );
}

// Selectable tile — used for segmented radios and platform checkboxes.
// Monochrome at rest, brand ring + tint when chosen. `as` lets a label
// wrap native radio/checkbox controls without extra markup.
const tileBase =
  "flex cursor-pointer select-none items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium transition-colors focus-within:ring-[3px] focus-within:ring-ring/32";
const tileOn = "border-brand/50 bg-brand/10 text-foreground";
const tileOff =
  "border-input text-muted-foreground hover:border-brand/30 hover:bg-brand/5 hover:text-foreground";

const PLATFORM_LABEL: Record<(typeof PLATFORMS)[number], string> = {
  tiktok: "TikTok",
  reels: "Reels",
  shorts: "Shorts",
};

const schema = z.object({
  // Step 1
  title: z.string().min(1, "Required"),
  description: z.string().min(1, "Required"),
  target_audience: z.string().min(1, "Required"),
  hashtags: z.array(z.string()),

  // Step 2
  visual_style: z.string().min(1, "Required"),
  voice: z.enum(VOICE_OPTIONS),
  target_duration_sec: z.coerce.number().int().min(15).max(90),
  scene_count: z.coerce.number().int().min(2).max(12),
  image_quality: z.enum(["low", "medium", "high"]),
  video_resolution: z.enum(["480p", "720p"]),
  scene_max_duration_sec: z.coerce.number().int().min(1).max(15),
  tts_style_directions: z.string(),

  // Step 3
  posting_hour: z.coerce.number().int().min(0).max(23),
  posting_minute: z.coerce.number().int().min(0).max(59),
  tz: z.string().min(1),
  platforms: z.array(z.enum(["tiktok", "reels", "shorts"])).min(1, "Pick one"),
  daily_spend_cap_usd: z.coerce.number().min(0.5),
  approve_before_post: z.boolean(),
});

type Values = z.infer<typeof schema>;

type StepKey = 1 | 2 | 3;
const STEP_FIELDS: Record<StepKey, (keyof Values)[]> = {
  1: ["title", "description", "target_audience"],
  2: [
    "visual_style",
    "voice",
    "target_duration_sec",
    "scene_count",
    "image_quality",
    "video_resolution",
    "scene_max_duration_sec",
  ],
  3: [
    "posting_hour",
    "posting_minute",
    "tz",
    "platforms",
    "daily_spend_cap_usd",
    "approve_before_post",
  ],
};

function defaultTz(): string {
  if (typeof Intl !== "undefined") {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }
  return "UTC";
}

export interface NicheDraftPrefill {
  title?: string;
  description?: string;
  target_audience?: string;
  hashtags?: string[];
  visual_style?: string;
  voice?: Values["voice"];
  target_duration_sec?: number;
  scene_count?: number;
  image_quality?: Values["image_quality"];
  video_resolution?: Values["video_resolution"];
  scene_max_duration_sec?: number;
  tts_style_directions?: string;
}

export function OnboardingForm({
  prefill,
  startStep = 1,
}: {
  prefill?: NicheDraftPrefill;
  startStep?: StepKey;
} = {}) {
  const router = useRouter();
  const [step, setStep] = React.useState<StepKey>(startStep);
  const [submitting, setSubmitting] = React.useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: {
      title: prefill?.title ?? "",
      description: prefill?.description ?? "",
      target_audience: prefill?.target_audience ?? "",
      hashtags: prefill?.hashtags ?? [],
      visual_style: prefill?.visual_style ?? "",
      voice: prefill?.voice ?? "onyx",
      target_duration_sec: prefill?.target_duration_sec ?? 60,
      scene_count: prefill?.scene_count ?? 6,
      image_quality: prefill?.image_quality ?? "medium",
      video_resolution: prefill?.video_resolution ?? "480p",
      scene_max_duration_sec: prefill?.scene_max_duration_sec ?? 5,
      tts_style_directions: prefill?.tts_style_directions ?? "",
      posting_hour: 9,
      posting_minute: 0,
      tz: defaultTz(),
      platforms: [],
      daily_spend_cap_usd: 5,
      approve_before_post: true,
    },
  });

  async function onNext() {
    const ok = await form.trigger(STEP_FIELDS[step]);
    if (!ok) return;
    if (step < 3) setStep(((step as number) + 1) as StepKey);
  }

  function onBack() {
    if (step > 1) setStep(((step as number) - 1) as StepKey);
  }

  async function onSubmit(values: Values) {
    setSubmitting(true);
    const fd = new FormData();
    fd.set("title", values.title);
    fd.set("description", values.description);
    fd.set("target_audience", values.target_audience);
    fd.set("hashtags", values.hashtags.join(","));
    fd.set("visual_style", values.visual_style);
    fd.set("voice", values.voice);
    fd.set("target_duration_sec", String(values.target_duration_sec));
    fd.set("scene_count", String(values.scene_count));
    fd.set("image_quality", values.image_quality);
    fd.set("video_resolution", values.video_resolution);
    fd.set("scene_max_duration_sec", String(values.scene_max_duration_sec));
    fd.set("tts_style_directions", values.tts_style_directions);
    fd.set("posting_hour", String(values.posting_hour));
    fd.set("posting_minute", String(values.posting_minute));
    fd.set("tz", values.tz);
    for (const p of values.platforms) fd.append("platforms", p);
    fd.set("daily_spend_cap_usd", String(values.daily_spend_cap_usd));
    if (values.approve_before_post) fd.set("approve_before_post", "on");

    const res = await createNicheAction({ ok: false }, fd);
    // createNicheAction redirects on success — we only reach here on
    // failure (when ok=false with an error message).
    setSubmitting(false);
    if (res.ok) {
      toast.success("Niche created");
      router.push("/dashboard");
    } else if (res.error) {
      toast.error(res.error);
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-6"
      >
        <Card>
          <CardHeader className="space-y-4">
            <CardTitle className="sr-only">Step {step} of 3</CardTitle>
            {/* Segmented stepper: done segments are solid brand, the
                current one pulses (the machine is recording this step),
                and completed steps are clickable to go back. */}
            <div className="grid grid-cols-3 gap-2" role="list">
              {(
                [
                  [1, "Identity"],
                  [2, "Creative"],
                  [3, "Schedule & cap"],
                ] as const
              ).map(([n, label]) => {
                const state =
                  n < step ? "done" : n === step ? "current" : "todo";
                return (
                  <button
                    aria-current={state === "current" ? "step" : undefined}
                    className="group flex flex-col gap-1.5 text-left disabled:cursor-default"
                    disabled={n >= step}
                    key={n}
                    onClick={() => n < step && setStep(n)}
                    role="listitem"
                    type="button"
                  >
                    <span
                      className={
                        state === "done"
                          ? "h-1 rounded-full bg-brand transition-colors"
                          : state === "current"
                            ? "h-1 animate-pulse rounded-full bg-brand/70"
                            : "h-1 rounded-full bg-muted"
                      }
                    />
                    <span
                      className={
                        state === "current"
                          ? "text-xs font-medium text-foreground"
                          : "text-xs text-muted-foreground group-hover:text-foreground group-disabled:group-hover:text-muted-foreground"
                      }
                    >
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {step === 1 && <StepIdentity />}
            {step === 2 && <StepCreative />}
            {step === 3 && <StepSchedule />}
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={onBack}
            disabled={step === 1}
          >
            Back
          </Button>
          {step < 3 ? (
            <Button type="button" onClick={onNext}>
              Next
            </Button>
          ) : (
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Create niche
            </Button>
          )}
        </div>
      </form>
    </Form>
  );
}

function StepIdentity() {
  return (
    <div className="space-y-5">
      <StepKicker>Channel identity</StepKicker>
      <FormField
        name="title"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Title</FormLabel>
            <FormControl>
              <Input placeholder="Claymation econ teacher" {...field} />
            </FormControl>
            <FormDescription>
              Short, human name for this niche — shown across your dashboard.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        name="description"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Description</FormLabel>
            <FormControl>
              <Textarea
                rows={3}
                placeholder="What this channel is about"
                {...field}
              />
            </FormControl>
            <FormDescription>
              Sets the editorial angle the script generator writes toward.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        name="target_audience"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Target audience</FormLabel>
            <FormControl>
              <Input
                placeholder="Curious adults who skipped college econ"
                {...field}
              />
            </FormControl>
            <FormDescription>
              Who each video should speak to — tone follows the audience.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <HashtagsField />
    </div>
  );
}

function HashtagsField() {
  return (
    <FormField
      name="hashtags"
      render={({ field }) => (
        <HashtagsFieldInner
          tags={field.value as string[]}
          onChange={field.onChange}
        />
      )}
    />
  );
}

function HashtagsFieldInner({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = React.useState("");

  function commit(raw: string) {
    const parts = raw
      .split(",")
      .map((s) => s.trim().replace(/^#+/, ""))
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = Array.from(new Set([...tags, ...parts]));
    onChange(next);
    setDraft("");
  }

  return (
    <FormItem>
      <FormLabel>Hashtags</FormLabel>
      <FormControl>
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-input bg-background p-2">
          {tags.map((t) => (
            <Badge key={t} variant="secondary" className="gap-1 pr-1">
              #{t}
              <button
                type="button"
                aria-label={`Remove ${t}`}
                className="rounded-full p-0.5 hover:bg-muted"
                onClick={() => onChange(tags.filter((x) => x !== t))}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <input
            className="min-w-[120px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder={tags.length === 0 ? "econ, macro, fed" : ""}
            value={draft}
            onChange={(e) => {
              const v = e.target.value;
              if (v.endsWith(",")) commit(v.slice(0, -1));
              else setDraft(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit(draft);
              } else if (
                e.key === "Backspace" &&
                draft === "" &&
                tags.length > 0
              ) {
                onChange(tags.slice(0, -1));
              }
            }}
            onBlur={() => draft && commit(draft)}
          />
        </div>
      </FormControl>
      <FormDescription>
        Comma or Enter to add · backspace on empty to remove last
      </FormDescription>
      <FormMessage />
    </FormItem>
  );
}

function StepCreative() {
  const watch = useFormWatch();
  const breakdown = estimateVideoCostUsd({
    scene_count: Number(watch.scene_count) || 1,
    image_quality: watch.image_quality,
    video_resolution: watch.video_resolution,
    scene_max_duration_sec: Number(watch.scene_max_duration_sec) || 1,
    target_duration_sec: Number(watch.target_duration_sec) || 1,
  });

  return (
    <>
      <FormField
        name="visual_style"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Visual style</FormLabel>
            <FormControl>
              <Textarea
                rows={3}
                placeholder="soft 3D claymation, pastel palette, shallow DOF"
                {...field}
              />
            </FormControl>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {STYLE_EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  className="rounded-full border bg-card px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => field.onChange(ex)}
                >
                  {ex}
                </button>
              ))}
            </div>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField
          name="voice"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Voice</FormLabel>
              <div className="flex items-center gap-2">
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {VOICE_OPTIONS.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <VoicePreviewButton voice={field.value} />
              </div>
              <FormDescription>
                Hit play — never pick a voice blind.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          name="target_duration_sec"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Duration (s)</FormLabel>
              <FormControl>
                <Input type="number" min={15} max={90} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          name="scene_count"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Scenes</FormLabel>
              <FormControl>
                <Input type="number" min={2} max={12} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        name="image_quality"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Image quality</FormLabel>
            <FormControl>
              <RadioGroup
                onValueChange={field.onChange}
                value={field.value}
                className="grid grid-cols-3 gap-2"
              >
                {QUALITIES.map((q) => (
                  <label
                    className={cn(
                      tileBase,
                      "capitalize",
                      field.value === q ? tileOn : tileOff,
                    )}
                    key={q}
                  >
                    <RadioGroupItem className="sr-only" value={q} />
                    {q}
                  </label>
                ))}
              </RadioGroup>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        name="video_resolution"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Video resolution</FormLabel>
            <FormControl>
              <RadioGroup
                onValueChange={field.onChange}
                value={field.value}
                className="grid grid-cols-2 gap-2"
              >
                {RESOLUTIONS.map((r) => (
                  <label
                    className={cn(tileBase, field.value === r ? tileOn : tileOff)}
                    key={r}
                  >
                    <RadioGroupItem className="sr-only" value={r} />
                    {r}
                  </label>
                ))}
              </RadioGroup>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        name="scene_max_duration_sec"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Max scene duration (s)</FormLabel>
            <FormControl>
              <Input type="number" min={1} max={15} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        name="tts_style_directions"
        render={({ field }) => (
          <FormItem>
            <FormLabel>TTS style directions</FormLabel>
            <FormControl>
              <Input
                placeholder="calm, conspiratorial narrator with deliberate pauses"
                {...field}
              />
            </FormControl>
            <FormDescription>Optional · passed verbatim to TTS</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <Card className="bg-muted/30">
        <CardContent className="flex items-baseline justify-between pt-6">
          <span className="text-sm text-muted-foreground">
            Estimated cost per video
          </span>
          <span className="font-mono text-lg font-semibold">
            {formatUsd(breakdown.total)}
          </span>
        </CardContent>
      </Card>
    </>
  );
}

function StepSchedule() {
  const watch = useFormWatch();
  const cap = Number(watch.daily_spend_cap_usd) || 0;
  const perVideo = estimateVideoCostUsd({
    scene_count: Number(watch.scene_count) || 1,
    image_quality: watch.image_quality,
    video_resolution: watch.video_resolution,
    scene_max_duration_sec: Number(watch.scene_max_duration_sec) || 1,
    target_duration_sec: Number(watch.target_duration_sec) || 1,
  }).total;
  const perDay = perVideo > 0 ? Math.floor(cap / perVideo) : 0;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField
          name="posting_hour"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Hour (0-23)</FormLabel>
              <FormControl>
                <Input type="number" min={0} max={23} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          name="posting_minute"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Minute</FormLabel>
              <FormControl>
                <Input type="number" min={0} max={59} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          name="tz"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Timezone</FormLabel>
              <FormControl>
                <Input placeholder="America/Los_Angeles" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        name="platforms"
        render={({ field }) => {
          const selected = (field.value as string[]) ?? [];
          function toggle(p: string) {
            if (selected.includes(p)) {
              field.onChange(selected.filter((x) => x !== p));
            } else {
              field.onChange([...selected, p]);
            }
          }
          return (
            <FormItem>
              <FormLabel>Platforms</FormLabel>
              <div className="grid grid-cols-3 gap-2">
                {PLATFORMS.map((p) => {
                  const on = selected.includes(p);
                  return (
                    <label
                      className={cn(tileBase, on ? tileOn : tileOff)}
                      key={p}
                    >
                      <Checkbox
                        checked={on}
                        className="sr-only"
                        onCheckedChange={() => toggle(p)}
                      />
                      {PLATFORM_LABEL[p]}
                    </label>
                  );
                })}
              </div>
              <FormMessage />
            </FormItem>
          );
        }}
      />

      <FormField
        name="daily_spend_cap_usd"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Daily spend cap (USD)</FormLabel>
            <FormControl>
              <Input type="number" step="0.01" min={0.5} {...field} />
            </FormControl>
            <FormDescription>
              ≈ {perDay} videos/day at current settings
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        name="approve_before_post"
        render={({ field }) => (
          <FormItem>
            <label
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border p-4 transition-colors",
                field.value
                  ? "border-brand/50 bg-brand/5"
                  : "border-input hover:border-brand/30",
              )}
            >
              <Checkbox
                checked={field.value}
                className="mt-0.5"
                onCheckedChange={field.onChange}
              />
              <span>
                <span className="block text-sm font-medium">
                  Review each video before it posts
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Rendered videos wait for your approval in the queue instead
                  of posting on schedule. Turn this off any time to go fully
                  autonomous.
                </span>
              </span>
            </label>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}

// Read live form state for the cost-estimate preview. Each step
// component calls this from inside the FormProvider in <Form>.
function useFormWatch(): Values {
  const { watch } = useFormContext<Values>();
  return watch();
}

// Plays a short cached sample of the selected voice, synthesized once
// server-side via GET /api/v1/voices/{voice}/preview.
function VoicePreviewButton({ voice }: { voice: string }) {
  const [state, setState] = React.useState<"idle" | "loading" | "playing">(
    "idle",
  );
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  async function toggle() {
    if (state === "playing") {
      audioRef.current?.pause();
      setState("idle");
      return;
    }
    setState("loading");
    try {
      const audio = new Audio(`/api/proxy/api/v1/voices/${voice}/preview`);
      audioRef.current = audio;
      audio.onended = () => setState("idle");
      audio.onerror = () => {
        setState("idle");
        toast.error("Voice preview unavailable");
      };
      await audio.play();
      setState("playing");
    } catch {
      setState("idle");
      toast.error("Voice preview unavailable");
    }
  }

  return (
    <Button
      aria-label={
        state === "playing"
          ? `Stop ${voice} preview`
          : `Play a sample of the ${voice} voice`
      }
      disabled={state === "loading"}
      onClick={toggle}
      size="icon-md"
      type="button"
      variant="outline"
    >
      {state === "loading" ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : state === "playing" ? (
        <Square className="size-3.5" aria-hidden />
      ) : (
        <Play className="size-4" aria-hidden />
      )}
    </Button>
  );
}
