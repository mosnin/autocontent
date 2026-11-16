"use client";

import { Plus, X } from "lucide-react";
import Link from "next/link";
import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { EMPTY_STATE, type ActionState } from "@/lib/action-state";
import { createPlaybookAction, updatePlaybookAction } from "@/lib/actions-work";
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
  type Platform,
  type ScriptModelOption,
  type StylePreset,
  type VideoModelOption,
  type VideoResolution,
} from "@/lib/types";
import { Panel } from "../page";
import { Button, buttonCls, Chip, cx, Field, FieldGroup, Input, Select, Switch, Textarea } from "../ui";
import { platformLabel } from "../content/status";

const VOICES = ["alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"];
const MECH_LABEL: Record<string, string> = {
  curiosity_gap: "Curiosity gap",
  contrarian: "Contrarian",
  mistake_or_stakes: "Mistake or stakes",
  story_cold_open: "Story cold open",
  bold_result: "Bold result",
  myth_bust: "Myth bust",
};

export interface EditorCatalog {
  videoModels: VideoModelOption[] | null;
  scriptModels: ScriptModelOption[] | null;
  audio: AudioProviders | null;
  kits: Kit[] | null;
  presets: StylePreset[] | null;
}

const SECTIONS = [
  { id: "audience", label: "Audience" },
  { id: "look", label: "Look & voice" },
  { id: "hooks", label: "Hooks & story" },
  { id: "visual", label: "Visual direction" },
  { id: "sound", label: "Sound & captions" },
  { id: "engine", label: "Models & kits" },
  { id: "prompts", label: "Prompt overrides" },
  { id: "schedule", label: "Schedule & approvals" },
];

function Grid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  return <div className={cx("grid gap-4", cols === 2 && "sm:grid-cols-2", cols === 3 && "sm:grid-cols-3", cols === 4 && "grid-cols-2 sm:grid-cols-4")}>{children}</div>;
}

function Section({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-4">
      <Panel label={label} bodyClassName="space-y-4">
        {hint && <p className="-mt-1 text-[13px] text-muted-foreground">{hint}</p>}
        {children}
      </Panel>
    </div>
  );
}

function SwitchRow({ name, label, detail, checked, onChange }: { name: string; label: string; detail?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-[14px] bg-subtle px-4 py-3 shadow-[inset_0_0_0_1px_hsl(var(--border))]">
      <div className="min-w-0">
        <div className="text-[14px] font-medium">{label}</div>
        {detail && <div className="text-[13px] text-muted-foreground">{detail}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
      {checked && <input type="hidden" name={name} value="on" />}
    </div>
  );
}

function PresetPicker({ presets, onApply }: { presets: StylePreset[]; onApply: (p: StylePreset) => void }) {
  const [applied, setApplied] = useState<string | null>(null);
  if (!presets.length) return null;
  return (
    <div className="space-y-1.5">
      <span className="text-[13px] text-muted-foreground">Or start from a preset</span>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={applied === p.id}
            onClick={() => (setApplied(p.id), onApply(p))}
            className={cx("press overflow-hidden rounded-lg border text-left transition-colors", applied === p.id ? "border-accent ring-2 ring-accent/20" : "border-border hover:border-border-strong")}
          >
            {p.reference_video_url ? (
              <video src={p.reference_video_url} muted loop playsInline preload="metadata" onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} className="h-14 w-full object-cover" />
            ) : (
              <span aria-hidden className="block h-14 w-full" style={{ background: p.swatch }} />
            )}
            <span className="block p-2">
              <span className="block truncate text-[13px] font-medium">{p.name}</span>
              <span className="block truncate text-[12px] text-muted-foreground">{p.tagline}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SaveButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" loading={pending}>
      {mode === "create" ? "Create playbook" : "Save changes"}
    </Button>
  );
}

const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

/**
 * Every field of a playbook (niche): audience, look, the creative brief,
 * models and kits, schedule and approvals. One form, organised in panels,
 * with a sticky save bar showing the live cost per video.
 */
export function PlaybookEditor({ mode, niche, catalog, cancelHref }: { mode: "create" | "edit"; niche: Niche; catalog: EditorCatalog; cancelHref: string }) {
  const [state, action] = useActionState<ActionState, FormData>(mode === "create" ? createPlaybookAction : updatePlaybookAction, EMPTY_STATE);
  const b = niche.creative_brief;

  const [visualStyle, setVisualStyle] = useState(niche.visual_style);
  const [character, setCharacter] = useState(niche.character_description ?? "");
  const [platforms, setPlatforms] = useState<Platform[]>(niche.platforms);
  const [mechs, setMechs] = useState<string[]>(b.hooks.preferred_mechanisms);
  const [approve, setApprove] = useState(niche.approve_before_post);
  const [music, setMusic] = useState(b.audio.music_enabled);
  const [upper, setUpper] = useState(b.audio.caption_style.uppercase);
  const [windows, setWindows] = useState(niche.posting_windows.length ? niche.posting_windows.map((w) => hhmm(w.hour, w.minute)) : ["09:00"]);
  const [voiceProvider, setVoiceProvider] = useState(niche.voice_provider ?? "openai");
  const [cost, setCost] = useState({
    scene_count: niche.scene_count,
    image_quality: niche.image_quality,
    video_resolution: niche.video_resolution,
    scene_max_duration_sec: niche.scene_max_duration_sec,
    target_duration_sec: niche.target_duration_sec,
  });
  const est = estimateVideoCostUsd({
    scene_count: Number(cost.scene_count) || 1,
    image_quality: cost.image_quality,
    video_resolution: cost.video_resolution,
    scene_max_duration_sec: Number(cost.scene_max_duration_sec) || 1,
    target_duration_sec: Number(cost.target_duration_sec) || 1,
  });

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const videoChoice = niche.video_provider === "fal" ? `fal:${niche.fal_model}` : "grok:";
  const videoModels = catalog.videoModels?.length ? catalog.videoModels : [{ provider: "grok", model_id: "", name: "Grok Imagine (default)", tagline: "", usd_per_second: "0.050", available: true } as VideoModelOption];
  const scriptModels = catalog.scriptModels?.length ? catalog.scriptModels : [{ model_id: "", name: "Platform default", tagline: "", usd_per_m_input: "-", usd_per_m_output: "-", available: true } as ScriptModelOption];
  const voices = catalog.audio?.voice_providers ?? [{ provider: "openai" as const, name: "OpenAI TTS (default)", tagline: "", available: true }];
  const kits = catalog.kits ?? [];
  const tz = niche.posting_windows[0]?.tz ?? "UTC";

  return (
    <form action={action} className="space-y-4">
      {mode === "edit" && <input type="hidden" name="niche_id" value={niche.id} />}
      <input type="hidden" name="providers_present" value="1" />
      <input type="hidden" name="brief_present" value="1" />

      <nav aria-label="Sections" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="press inline-flex h-8 shrink-0 items-center rounded-full border border-border px-3 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground">
            {s.label}
          </a>
        ))}
      </nav>

      <Section id="audience" label="Audience" hint="What this playbook is and who it's for. Every department reads this first.">
        <Field label="Name">
          <Input name="title" defaultValue={niche.title} required placeholder="e.g. Pasta at home" />
        </Field>
        <Field label="What it's about">
          <Textarea name="description" defaultValue={niche.description} rows={2} required placeholder="Short, warm lessons that make fresh pasta feel doable on a weeknight." />
        </Field>
        <Field label="Who it's for">
          <Input name="target_audience" defaultValue={niche.target_audience} required placeholder="Home cooks, 25–45, who want restaurant pasta without the fuss" />
        </Field>
        <Field label="Hashtags" hint="Comma-separated, without #.">
          <Input name="hashtags" defaultValue={niche.hashtags.join(", ")} placeholder="pasta, homecooking" />
        </Field>
      </Section>

      <Section id="look" label="Look & voice" hint="How videos look and sound, and how long they run.">
        <Field label="Visual style">
          <Textarea name="visual_style" value={visualStyle} onChange={(e) => setVisualStyle(e.target.value)} rows={3} required placeholder="Warm claymation kitchen, soft window light, flour dust in the air" />
        </Field>
        <PresetPicker
          presets={catalog.presets ?? []}
          onApply={(p) => {
            setVisualStyle(p.visual_style);
            if (p.character_suggestion && !character) setCharacter(p.character_suggestion);
          }}
        />
        <Field label="Recurring character" hint="Optional. Rendered in every video; changing it regenerates the character sheet on the next run.">
          <Input name="character_description" value={character} onChange={(e) => setCharacter(e.target.value)} placeholder="Nonna Rosa, a tiny clay grandmother in a floral apron" />
        </Field>
        <Grid>
          <Field label="Narrator voice">
            <Select name="voice" defaultValue={niche.voice}>
              {(VOICES.includes(niche.voice) ? VOICES : [niche.voice, ...VOICES]).map((v) => (
                <option key={v} value={v} className="capitalize">
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Voice direction" hint="Optional, passed to the narrator as is.">
            <Input name="tts_style_directions" defaultValue={niche.tts_style_directions ?? ""} placeholder="warm, a little conspiratorial" />
          </Field>
        </Grid>
        <Grid cols={3}>
          <Field label="Length (seconds)">
            <Input name="target_duration_sec" type="number" min={15} max={90} defaultValue={niche.target_duration_sec} onChange={(e) => setCost((c) => ({ ...c, target_duration_sec: Number(e.target.value) }))} required />
          </Field>
          <Field label="Scenes">
            <Input name="scene_count" type="number" min={2} max={12} defaultValue={niche.scene_count} onChange={(e) => setCost((c) => ({ ...c, scene_count: Number(e.target.value) }))} required />
          </Field>
          <Field label="Longest scene (seconds)">
            <Input name="scene_max_duration_sec" type="number" min={1} max={15} defaultValue={niche.scene_max_duration_sec} onChange={(e) => setCost((c) => ({ ...c, scene_max_duration_sec: Number(e.target.value) }))} required />
          </Field>
          <Field label="Image quality">
            <Select name="image_quality" defaultValue={niche.image_quality} onChange={(e) => setCost((c) => ({ ...c, image_quality: e.target.value as ImageQuality }))}>
              {QUALITIES.map((q) => (
                <option key={q} value={q}>
                  {q[0].toUpperCase() + q.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Video resolution">
            <Select name="video_resolution" defaultValue={niche.video_resolution} onChange={(e) => setCost((c) => ({ ...c, video_resolution: e.target.value as VideoResolution }))}>
              {RESOLUTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
        </Grid>
      </Section>

      <Section id="hooks" label="Hooks & story" hint="The creative brief: how every script opens, speaks and ends. Empty fields use sensible defaults.">
        <FieldGroup label="Hook styles to favour">
          <div className="flex flex-wrap gap-1.5">
            {HOOK_MECHANISMS.map((m) => (
              <Chip key={m} selected={mechs.includes(m)} onClick={() => setMechs((x) => toggle(x, m))}>
                {MECH_LABEL[m] ?? m}
              </Chip>
            ))}
          </div>
          {mechs.map((m) => (
            <input key={m} type="hidden" name="brief_mechanisms" value={m} />
          ))}
        </FieldGroup>
        <Field label="Hooks you love" hint="One per line, up to 10. Matched for voice, never copied.">
          <Textarea name="brief_example_hooks" rows={3} defaultValue={b.hooks.example_hooks.join("\n")} placeholder={"You're salting your pasta water wrong\nStop rinsing your pasta"} />
        </Field>
        <Field label="Never open with" hint="Comma-separated.">
          <Input name="brief_banned_openers" defaultValue={b.hooks.banned_openers.join(", ")} placeholder="hey guys, in this video" />
        </Field>
        <Grid>
          <Field label="Language" hint="Narration and captions.">
            <Input name="brief_language" defaultValue={b.narrative.language} placeholder="English" />
          </Field>
          <Field label="Point of view">
            <Input name="brief_pov" defaultValue={b.narrative.pov} placeholder="a friendly Italian grandmother" />
          </Field>
          <Field label="Pacing">
            <Input name="brief_pacing" defaultValue={b.narrative.pacing} placeholder="quick and punchy" />
          </Field>
          <Field label="Reading level">
            <Input name="brief_reading_level" defaultValue={b.narrative.reading_level} placeholder="grade 6" />
          </Field>
        </Grid>
        <Field label="Call to action">
          <Input name="brief_cta_policy" defaultValue={b.narrative.cta_policy} placeholder="never, or only 'follow for part 2'" />
        </Field>
        <Grid>
          <Field label="Always include" hint="Comma-separated.">
            <Input name="brief_must_include" defaultValue={b.narrative.must_include.join(", ")} placeholder="one practical tip" />
          </Field>
          <Field label="Topics to avoid" hint="Comma-separated hard bans.">
            <Input name="brief_must_avoid" defaultValue={b.narrative.must_avoid.join(", ")} placeholder="calorie counts, brand names" />
          </Field>
        </Grid>
      </Section>

      <Section id="visual" label="Visual direction">
        <Grid>
          <Field label="Camera">
            <Input name="brief_camera_language" defaultValue={b.visual.camera_language} placeholder="slow push-ins, no whip pans" />
          </Field>
          <Field label="Lighting">
            <Input name="brief_lighting" defaultValue={b.visual.lighting} placeholder="warm window light" />
          </Field>
          <Field label="Colour palette">
            <Input name="brief_color_palette" defaultValue={b.visual.color_palette} placeholder="terracotta, cream, basil green" />
          </Field>
          <Field label="Never show" hint="Comma-separated.">
            <Input name="brief_negative_visuals" defaultValue={b.visual.negative_visuals.join(", ")} placeholder="logos, phones, crowds" />
          </Field>
        </Grid>
      </Section>

      <Section id="sound" label="Sound & captions">
        <SwitchRow name="brief_music_enabled" label="Background music" detail="Ducked under the narration automatically." checked={music} onChange={setMusic} />
        <Field label="Music mood" hint="A search phrase for the track.">
          <Input name="brief_music_mood" defaultValue={b.audio.music_mood} placeholder="warm acoustic, mandolin" disabled={!music} />
        </Field>
        <Grid cols={4}>
          <Field label="Caption font">
            <Input name="brief_caption_font" defaultValue={b.audio.caption_style.font} />
          </Field>
          <Field label="Size">
            <Input name="brief_caption_size" type="number" min={40} max={160} defaultValue={b.audio.caption_style.font_size} />
          </Field>
          <Field label="Text colour">
            <Input name="brief_caption_text_hex" type="color" defaultValue={`#${b.audio.caption_style.text_hex}`} className="h-[38px] cursor-pointer p-1" />
          </Field>
          <Field label="Outline colour">
            <Input name="brief_caption_outline_hex" type="color" defaultValue={`#${b.audio.caption_style.outline_hex}`} className="h-[38px] cursor-pointer p-1" />
          </Field>
        </Grid>
        <Grid>
          <Field label="Caption position">
            <Select name="brief_caption_position" defaultValue={b.audio.caption_style.position}>
              <option value="bottom">Bottom</option>
              <option value="center">Center</option>
              <option value="top">Top</option>
            </Select>
          </Field>
          <div className="sm:pt-[22px]">
            <SwitchRow name="brief_caption_uppercase" label="All-caps captions" checked={upper} onChange={setUpper} />
          </div>
        </Grid>
      </Section>

      <Section id="engine" label="Models & kits" hint="Which models render and write, and which of your kits ride along.">
        <Grid>
          <Field label="Video model" hint="Price per rendered second.">
            <Select name="video_model_choice" defaultValue={videoChoice}>
              {videoModels.map((m) => (
                <option key={`${m.provider}:${m.model_id}`} value={`${m.provider}:${m.model_id}`} disabled={!m.available}>
                  {m.name} · ${m.usd_per_second}/s{m.available ? "" : " (not configured)"}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Script model" hint="Price per million tokens, in / out.">
            <Select name="script_model" defaultValue={niche.script_model}>
              {scriptModels.map((m) => (
                <option key={m.model_id} value={m.model_id} disabled={!m.available}>
                  {m.name}
                  {m.model_id ? ` · $${m.usd_per_m_input} / $${m.usd_per_m_output}` : ""}
                  {m.available ? "" : " (not configured)"}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Voice engine">
            <Select name="voice_provider" value={voiceProvider} onChange={(e) => setVoiceProvider(e.target.value as "openai" | "elevenlabs")}>
              {voices.map((v) => (
                <option key={v.provider} value={v.provider} disabled={!v.available}>
                  {v.name}
                  {v.available ? "" : " (not configured)"}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="ElevenLabs voice ID" hint="Only used with ElevenLabs. Empty uses the default voice.">
            <Input name="elevenlabs_voice_id" defaultValue={niche.elevenlabs_voice_id ?? ""} placeholder="21m00Tcm4TlvDq8ikWAM" className="font-mono" disabled={voiceProvider !== "elevenlabs"} />
          </Field>
          <Field label="Music source" hint="Generated composes an original score per video.">
            <Select name="music_provider" defaultValue={niche.music_provider ?? "auto"}>
              <option value="auto">Auto{catalog.audio?.generated_music_available ? " (generated when available)" : " (library)"}</option>
              <option value="library">Library only</option>
              <option value="generated" disabled={!catalog.audio?.generated_music_available}>
                Generated score{catalog.audio?.generated_music_available ? "" : " (not configured)"}
              </option>
            </Select>
          </Field>
          <span className="hidden sm:block" />
          <Field label="Design kit" hint="Your visual direction system.">
            <Select name="design_kit_id" defaultValue={niche.design_kit_id ?? ""}>
              <option value="">Default design kit, or none</option>
              {kits
                .filter((k) => k.kind === "design")
                .map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Writing kit" hint="The voice for this playbook's articles.">
            <Select name="writing_kit_id" defaultValue={niche.writing_kit_id ?? ""}>
              <option value="">Default writing kit, or none</option>
              {kits
                .filter((k) => k.kind === "writing")
                .map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
            </Select>
          </Field>
        </Grid>
      </Section>

      <Section id="prompts" label="Prompt overrides" hint="Appended as is to each step's instructions. For when the brief isn't enough.">
        <Grid>
          <Field label="Ideation">
            <Textarea name="brief_extra_ideation" rows={2} defaultValue={b.prompt_overrides.ideation} placeholder="favour seasonal ingredients" />
          </Field>
          <Field label="Scriptwriter">
            <Textarea name="brief_extra_script" rows={2} defaultValue={b.prompt_overrides.scriptwriter} placeholder="end every script on a question" />
          </Field>
          <Field label="Visual director">
            <Textarea name="brief_extra_visual" rows={2} defaultValue={b.prompt_overrides.visual_director} placeholder="every scene includes the copper pot" />
          </Field>
          <Field label="QA">
            <Textarea name="brief_extra_qa" rows={2} defaultValue={b.prompt_overrides.qa} placeholder="reject hooks longer than 8 words" />
          </Field>
        </Grid>
      </Section>

      <Section id="schedule" label="Schedule & approvals" hint="Where it posts, when, and how much it may spend in a day.">
        <FieldGroup label="Platforms">
          <div className="flex flex-wrap gap-1.5">
            {PLATFORMS.map((p) => (
              <Chip key={p} selected={platforms.includes(p)} onClick={() => setPlatforms((x) => toggle(x, p))}>
                {platformLabel(p)}
              </Chip>
            ))}
          </div>
          {platforms.map((p) => (
            <input key={p} type="hidden" name="platforms" value={p} />
          ))}
        </FieldGroup>
        <FieldGroup label="Posting windows" hint="One video per window per platform, inside the daily cap.">
          <div className="flex flex-wrap items-center gap-2">
            {windows.map((w, i) => (
              <span key={i} className="flex items-center gap-1">
                <Input type="time" name="pw" value={w} onChange={(e) => setWindows((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Posting time ${i + 1}`} className="w-[128px] tabular" required />
                {windows.length > 1 && (
                  <Button variant="ghost" size="icon" className="size-8" aria-label="Remove time" onClick={() => setWindows((xs) => xs.filter((_, j) => j !== i))}>
                    <X />
                  </Button>
                )}
              </span>
            ))}
            {windows.length < 6 && (
              <Button variant="ghost" size="sm" onClick={() => setWindows((xs) => [...xs, "18:00"])}>
                <Plus />
                Add a time
              </Button>
            )}
          </div>
        </FieldGroup>
        <Grid>
          <Field label="Time zone" hint="IANA name, e.g. America/New_York.">
            <Input name="tz" defaultValue={tz} required className="font-mono text-[13px]" />
          </Field>
          <Field label="Daily spend cap (USD)" hint="Videos wait for tomorrow once today's cap is reached.">
            <Input name="daily_spend_cap_usd" type="number" step="0.01" min={0.5} defaultValue={niche.daily_spend_cap_usd} required className="tabular" />
          </Field>
        </Grid>
        <SwitchRow name="approve_before_post" label="Review each video before it posts" detail="Finished videos wait in your inbox for a yes instead of posting on schedule." checked={approve} onChange={setApprove} />
      </Section>

      <div className="sticky bottom-0 z-10 -mx-5 border-t border-border bg-background/90 px-5 py-3 backdrop-blur sm:-mx-8 sm:px-8">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-muted-foreground">
              About <span className="font-medium text-foreground tabular">{formatUsd(est.total)}</span> per video
            </div>
            {state.error && (
              <p role="alert" className="text-[13px] text-destructive">
                {state.error}
              </p>
            )}
          </div>
          <Link href={cancelHref} className={buttonCls("ghost")}>
            Cancel
          </Link>
          <SaveButton mode={mode} />
        </div>
      </div>
    </form>
  );
}
