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
import { ArrowLeft, ArrowRight, Loader2, X } from "lucide-react";
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
import { Progress } from "@/components/ui/progress";
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

export function OnboardingForm() {
  const router = useRouter();
  const [step, setStep] = React.useState<StepKey>(1);
  const [submitting, setSubmitting] = React.useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: {
      title: "",
      description: "",
      target_audience: "",
      hashtags: [],
      visual_style: "",
      voice: "onyx",
      target_duration_sec: 60,
      scene_count: 6,
      image_quality: "medium",
      video_resolution: "480p",
      scene_max_duration_sec: 5,
      tts_style_directions: "",
      posting_hour: 9,
      posting_minute: 0,
      tz: defaultTz(),
      platforms: [],
      daily_spend_cap_usd: 5,
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
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">
                Step {step} of 3
              </CardTitle>
              <span className="text-xs text-muted-foreground">
                {step === 1 && "Identity"}
                {step === 2 && "Creative"}
                {step === 3 && "Schedule & cap"}
              </span>
            </div>
            <Progress value={(step / 3) * 100} />
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
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          {step < 3 ? (
            <Button type="button" onClick={onNext}>
              Next
              <ArrowRight className="h-4 w-4" />
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
    <>
      <FormField
        name="title"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Title</FormLabel>
            <FormControl>
              <Input placeholder="Claymation econ teacher" {...field} />
            </FormControl>
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
            <FormMessage />
          </FormItem>
        )}
      />
      <HashtagsField />
    </>
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
                    key={q}
                    className="flex items-center gap-2 rounded-md border p-3 text-sm capitalize hover:bg-accent/30"
                  >
                    <RadioGroupItem value={q} />
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
                    key={r}
                    className="flex items-center gap-2 rounded-md border p-3 text-sm hover:bg-accent/30"
                  >
                    <RadioGroupItem value={r} />
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
                {PLATFORMS.map((p) => (
                  <label
                    key={p}
                    className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm capitalize hover:bg-accent/30"
                  >
                    <Checkbox
                      checked={selected.includes(p)}
                      onCheckedChange={() => toggle(p)}
                    />
                    {p}
                  </label>
                ))}
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
    </>
  );
}

// Read live form state for the cost-estimate preview. Each step
// component calls this from inside the FormProvider in <Form>.
function useFormWatch(): Values {
  const { watch } = useFormContext<Values>();
  return watch();
}
