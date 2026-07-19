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

import { StylePresetPicker } from "@/components/style-preset-picker";
import { clientFetch } from "@/lib/client-fetcher";
import { updateNicheAction } from "@/lib/actions";
import { EMPTY_STATE, type ActionState } from "@/lib/action-state";
import { estimateVideoCostUsd } from "@/lib/cost-estimator";
import { formatUsd } from "@/lib/format";
import {
  HOOK_MECHANISMS,
  PLATFORMS,
  QUALITIES,
  RESOLUTIONS,
  type AudioProviders,
  type ImageQuality,
  type Kit,
  type Niche,
  type ScriptModelOption,
  type VideoModelOption,
  type VideoResolution,
  type VoiceProviderOption,
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

  // Controlled so the preset picker can apply a style; still serialized
  // through the native form via name="visual_style".
  const [visualStyle, setVisualStyle] = React.useState(niche.visual_style);

  const brief = niche.creative_brief;

  // Provider catalogs + kits for the "Models & kits" selectors. Each also
  // gets a "did this fetch settle" flag — options length alone is an
  // unreliable proxy (an account with zero kits would leave `kits`
  // permanently empty, keeping the select's remount key stuck on
  // "loading" and hiding a real load failure).
  const [videoModels, setVideoModels] = React.useState<VideoModelOption[]>([]);
  const [scriptModels, setScriptModels] = React.useState<ScriptModelOption[]>([]);
  const [audio, setAudio] = React.useState<AudioProviders | null>(null);
  const [kits, setKits] = React.useState<Kit[]>([]);
  const [kitsLoaded, setKitsLoaded] = React.useState(false);
  React.useEffect(() => {
    clientFetch<VideoModelOption[]>("/api/v1/providers/video-models")
      .then(setVideoModels)
      .catch(() => {});
    clientFetch<ScriptModelOption[]>("/api/v1/providers/script-models")
      .then(setScriptModels)
      .catch(() => {});
    clientFetch<AudioProviders>("/api/v1/providers/audio")
      .then(setAudio)
      .catch(() => {});
    clientFetch<Kit[]>("/api/v1/kits")
      .then(setKits)
      .catch(() => {})
      .finally(() => setKitsLoaded(true));
  }, []);
  const videoChoice =
    niche.video_provider === "fal" ? `fal:${niche.fal_model}` : "grok:";

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
            value={visualStyle}
            onChange={(e) => setVisualStyle(e.target.value)}
            rows={3}
            required
          />
          <StylePresetPicker
            className="pt-2"
            onApply={(preset) => setVisualStyle(preset.visual_style)}
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

        <Labelled
          label="Custom characters"
          hint="Optional — recurring cast rendered in every video. Editing regenerates the reference sheet on the next job."
          htmlFor="niche-character_description"
        >
          <Input
            id="niche-character_description"
            name="character_description"
            defaultValue={niche.character_description ?? ""}
            placeholder="a grumpy clay llama named Sol wearing a tiny lab coat"
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
        kicker="Models & kits"
        title="Engine room"
        description="Which models render and write, and which of your kits ride along."
      >
        <input type="hidden" name="providers_present" value="1" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Labelled
            label="Video model"
            hint="Price shown per rendered second"
            htmlFor="niche-video_model"
          >
            <select
              // Options arrive async (clientFetch resolves after first
              // paint). An uncontrolled <select defaultValue> only
              // applies its default at mount, so if the niche's saved
              // choice isn't among the initial fallback options, the
              // browser silently falls back to the first option and
              // never re-syncs once the real list loads. Keying on
              // whether the fetch has resolved forces a remount, so
              // defaultValue is re-evaluated against the real options.
              key={videoModels.length ? "loaded" : "loading"}
              id="niche-video_model"
              name="video_model_choice"
              defaultValue={videoChoice}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {(videoModels.length
                ? videoModels
                : [{ provider: "grok", model_id: "", name: "Grok Imagine (default)", tagline: "", usd_per_second: "0.050", available: true } as VideoModelOption]
              ).map((m) => (
                <option
                  key={`${m.provider}:${m.model_id}`}
                  value={`${m.provider}:${m.model_id}`}
                  disabled={!m.available}
                >
                  {m.name} — ${m.usd_per_second}/s{m.available ? "" : " (key not configured)"}
                </option>
              ))}
            </select>
          </Labelled>
          <Labelled
            label="Scriptwriter model"
            hint="Prices per 1M tokens (in / out)"
            htmlFor="niche-script_model"
          >
            <select
              key={scriptModels.length ? "loaded" : "loading"}
              id="niche-script_model"
              name="script_model"
              defaultValue={niche.script_model}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {(scriptModels.length
                ? scriptModels
                : [{ model_id: "", name: "Platform default", tagline: "", usd_per_m_input: "-", usd_per_m_output: "-", available: true } as ScriptModelOption]
              ).map((m) => (
                <option key={m.model_id} value={m.model_id} disabled={!m.available}>
                  {m.name}
                  {m.model_id ? ` — $${m.usd_per_m_input}/$${m.usd_per_m_output}` : ""}
                  {m.available ? "" : " (key not configured)"}
                </option>
              ))}
            </select>
          </Labelled>
          <Labelled
            label="Voice engine"
            hint="Who narrates — ElevenLabs needs a configured key"
            htmlFor="niche-voice_provider"
          >
            <select
              key={audio ? "loaded" : "loading"}
              id="niche-voice_provider"
              name="voice_provider"
              defaultValue={niche.voice_provider ?? "openai"}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {(audio?.voice_providers ?? [
                { provider: "openai", name: "OpenAI TTS (default)", tagline: "", available: true } as VoiceProviderOption,
              ]).map((v) => (
                <option key={v.provider} value={v.provider} disabled={!v.available}>
                  {v.name}{v.available ? "" : " (key not configured)"}
                </option>
              ))}
            </select>
          </Labelled>
          <Labelled
            label="ElevenLabs voice ID"
            hint="Only used with the ElevenLabs engine — empty = deploy default"
            htmlFor="niche-elevenlabs_voice_id"
          >
            <Input
              id="niche-elevenlabs_voice_id"
              name="elevenlabs_voice_id"
              defaultValue={niche.elevenlabs_voice_id ?? ""}
              placeholder="e.g. 21m00Tcm4TlvDq8ikWAM"
            />
          </Labelled>
          <Labelled
            label="Music source"
            hint="Generated = an original score composed per video"
            htmlFor="niche-music_provider"
          >
            <select
              id="niche-music_provider"
              name="music_provider"
              defaultValue={niche.music_provider ?? "auto"}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="auto">
                Auto{audio?.generated_music_available ? " (generated when available)" : " (library)"}
              </option>
              <option value="library">Library / Pixabay only</option>
              <option value="generated" disabled={!audio?.generated_music_available}>
                Generated score{audio?.generated_music_available ? "" : " (key not configured)"}
              </option>
            </select>
          </Labelled>
          <Labelled
            label="Design kit"
            hint="Your direction system — manage in Suite → Kits"
            htmlFor="niche-design_kit"
          >
            <select
              key={kitsLoaded ? "loaded" : "loading"}
              id="niche-design_kit"
              name="design_kit_id"
              defaultValue={niche.design_kit_id ?? ""}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Default design kit (or none)</option>
              {kits.filter((k) => k.kind === "design").map((k) => (
                <option key={k.id} value={k.id}>{k.name}</option>
              ))}
            </select>
          </Labelled>
          <Labelled
            label="Writing kit"
            hint="Article voice — used by Press for this niche"
            htmlFor="niche-writing_kit"
          >
            <select
              key={kitsLoaded ? "loaded" : "loading"}
              id="niche-writing_kit"
              name="writing_kit_id"
              defaultValue={niche.writing_kit_id ?? ""}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Default writing kit (or none)</option>
              {kits.filter((k) => k.kind === "writing").map((k) => (
                <option key={k.id} value={k.id}>{k.name}</option>
              ))}
            </select>
          </Labelled>
        </div>
      </SectionCard>

      <SectionCard
        kicker="Creative DNA"
        title="Make it unmistakably yours"
        description="Every field here steers the AI with precision — hooks, voice, visuals, music, captions. Empty fields use platform defaults."
      >
        <input type="hidden" name="brief_present" value="1" />

        <div
          className="space-y-2"
          role="group"
          aria-labelledby="brief-mechanisms-label"
        >
          <Label id="brief-mechanisms-label">Preferred hook styles</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {HOOK_MECHANISMS.map((m) => (
              <label
                key={m}
                className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm transition-colors hover:bg-accent/30"
              >
                <input
                  type="checkbox"
                  name="brief_mechanisms"
                  value={m}
                  defaultChecked={brief.hooks.preferred_mechanisms.includes(m)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                {m.replace(/_/g, " ")}
              </label>
            ))}
          </div>
        </div>

        <Labelled
          label="Hooks you love"
          hint="One per line (max 10) — the AI matches their voice, never copies"
          htmlFor="brief-example_hooks"
        >
          <Textarea
            id="brief-example_hooks"
            name="brief_example_hooks"
            rows={3}
            defaultValue={brief.hooks.example_hooks.join("\n")}
            placeholder={"why your llama videos flop\nthe $3 mistake in every portfolio"}
          />
        </Labelled>

        <div className="grid gap-4 sm:grid-cols-2">
          <Labelled label="Language" hint="Narration + captions" htmlFor="brief-language">
            <Input id="brief-language" name="brief_language"
              defaultValue={brief.narrative.language} placeholder="English (default)" />
          </Labelled>
          <Labelled label="Pacing" htmlFor="brief-pacing">
            <Input id="brief-pacing" name="brief_pacing"
              defaultValue={brief.narrative.pacing} placeholder="rapid-fire / calm and deliberate" />
          </Labelled>
          <Labelled label="Point of view" htmlFor="brief-pov">
            <Input id="brief-pov" name="brief_pov"
              defaultValue={brief.narrative.pov} placeholder="first-person operator" />
          </Labelled>
          <Labelled label="CTA policy" htmlFor="brief-cta_policy">
            <Input id="brief-cta_policy" name="brief_cta_policy"
              defaultValue={brief.narrative.cta_policy} placeholder="never / only 'follow for part 2'" />
          </Labelled>
        </div>

        <Labelled
          label="Topics to avoid"
          hint="Comma-separated hard bans"
          htmlFor="brief-must_avoid"
        >
          <Input id="brief-must_avoid" name="brief_must_avoid"
            defaultValue={brief.narrative.must_avoid.join(", ")}
            placeholder="politics, crypto price predictions" />
        </Labelled>

        <div className="grid gap-4 sm:grid-cols-2">
          <Labelled label="Camera language" htmlFor="brief-camera_language">
            <Input id="brief-camera_language" name="brief_camera_language"
              defaultValue={brief.visual.camera_language}
              placeholder="slow push-ins only, no whip pans" />
          </Labelled>
          <Labelled label="Lighting" htmlFor="brief-lighting">
            <Input id="brief-lighting" name="brief_lighting"
              defaultValue={brief.visual.lighting} placeholder="golden hour, soft shadows" />
          </Labelled>
          <Labelled label="Color palette" htmlFor="brief-color_palette">
            <Input id="brief-color_palette" name="brief_color_palette"
              defaultValue={brief.visual.color_palette}
              placeholder="warm terracotta + cream, no neon" />
          </Labelled>
          <Labelled label="Never show" hint="Comma-separated" htmlFor="brief-negative_visuals">
            <Input id="brief-negative_visuals" name="brief_negative_visuals"
              defaultValue={brief.visual.negative_visuals.join(", ")}
              placeholder="logos, phones, crowds" />
          </Labelled>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-input p-4 transition-colors hover:border-brand/30">
            <input
              className="mt-0.5 size-4 accent-[hsl(var(--brand))]"
              defaultChecked={brief.audio.music_enabled}
              name="brief_music_enabled"
              type="checkbox"
            />
            <span>
              <span className="block text-sm font-medium">Background music</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Ducked under the narration automatically.
              </span>
            </span>
          </label>
          <Labelled label="Music mood" hint="Search phrase for the track" htmlFor="brief-music_mood">
            <Input id="brief-music_mood" name="brief_music_mood"
              defaultValue={brief.audio.music_mood} placeholder="lofi hip hop, calm" />
          </Labelled>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <Labelled label="Caption font" htmlFor="brief-caption_font">
            <Input id="brief-caption_font" name="brief_caption_font"
              defaultValue={brief.audio.caption_style.font} />
          </Labelled>
          <Labelled label="Size" htmlFor="brief-caption_size">
            <Input id="brief-caption_size" name="brief_caption_size" type="number"
              min={40} max={160} defaultValue={brief.audio.caption_style.font_size} />
          </Labelled>
          <Labelled label="Text color" htmlFor="brief-caption_text_hex">
            <Input id="brief-caption_text_hex" name="brief_caption_text_hex" type="color"
              defaultValue={`#${brief.audio.caption_style.text_hex}`} className="h-10 p-1" />
          </Labelled>
          <Labelled label="Position" htmlFor="brief-caption_position">
            <select
              id="brief-caption_position"
              name="brief_caption_position"
              defaultValue={brief.audio.caption_style.position}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="bottom">Bottom</option>
              <option value="center">Center</option>
              <option value="top">Top</option>
            </select>
          </Labelled>
        </div>
        <input type="hidden" name="brief_caption_outline_hex"
          defaultValue={brief.audio.caption_style.outline_hex} />
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" name="brief_caption_uppercase"
            defaultChecked={brief.audio.caption_style.uppercase}
            className="h-4 w-4 rounded border-input accent-primary" />
          ALL-CAPS captions
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <Labelled
            label="Extra script instructions"
            hint="Appended verbatim to the scriptwriter"
            htmlFor="brief-extra_script"
          >
            <Textarea id="brief-extra_script" name="brief_extra_script" rows={2}
              defaultValue={brief.prompt_overrides.scriptwriter}
              placeholder="always end scenes on a question" />
          </Labelled>
          <Labelled
            label="Extra visual instructions"
            hint="Appended verbatim to the visual director"
            htmlFor="brief-extra_visual"
          >
            <Textarea id="brief-extra_visual" name="brief_extra_visual" rows={2}
              defaultValue={brief.prompt_overrides.visual_director}
              placeholder="every scene includes the studio's neon sign" />
          </Labelled>
        </div>
        <input type="hidden" name="brief_extra_ideation"
          defaultValue={brief.prompt_overrides.ideation} />
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
