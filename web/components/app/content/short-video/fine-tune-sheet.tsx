"use client";

import type { ReactNode } from "react";
import { Button, Field, Input, Segmented, Select, Sheet, SwitchRow } from "@/design-system";
import { changedFromDefaults, DEFAULT_SETTINGS, patch, type ShortVideoSettings, type Transition } from "@/lib/short-video";

/** Everything most people never need, in one place: edit, subtitle and music details. */
export function FineTuneSheet({ open, onClose, settings: s, onChange }: { open: boolean; onClose: () => void; settings: ShortVideoSettings; onChange: (s: ShortVideoSettings) => void }) {
  const changed = changedFromDefaults(s);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Fine-tune"
      description={changed.length ? changed.join(" · ") : "Using the defaults."}
      footer={
        <>
          <Button variant="ghost" disabled={!changed.length} onClick={() => onChange({ ...DEFAULT_SETTINGS, look: { ...s.look, tone: "" }, footage: { ...DEFAULT_SETTINGS.footage, sources: s.footage.sources, upload_ids: s.footage.upload_ids } })}>
            Reset
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="space-y-8">
        <Group title="Edit">
          <Range label="Clip length" value={s.footage.clip_duration_sec} min={2} max={10} step={0.5} format={(v) => `${v}s`} onChange={(v) => onChange(patch(s, "footage", { clip_duration_sec: v }))} />
          <Range label="Playback speed" value={s.footage.speed} min={0.5} max={2} step={0.25} format={(v) => `${v}×`} onChange={(v) => onChange(patch(s, "footage", { speed: v }))} />
          <Field label="Transition">
            <Select value={s.footage.transition} onChange={(e) => onChange(patch(s, "footage", { transition: e.target.value as Transition }))}>
              <option value="fade">Fade</option>
              <option value="fade_in">Fade in</option>
              <option value="fade_out">Fade out</option>
              <option value="shuffle">Mixed</option>
              <option value="none">Hard cut</option>
            </Select>
          </Field>
          <Row label="Framing">
            <Segmented size="sm" label="Framing" value={s.footage.fit} onChange={(v) => onChange(patch(s, "footage", { fit: v }))} options={[{ value: "crop", label: "Fill" }, { value: "letterbox", label: "Letterbox" }]} />
          </Row>
          <Row label="Clip order">
            <Segmented size="sm" label="Clip order" value={s.footage.order} onChange={(v) => onChange(patch(s, "footage", { order: v }))} options={[{ value: "random", label: "Shuffled" }, { value: "sequential", label: "Follow the script" }]} />
          </Row>
        </Group>

        <Group title="Subtitles">
          <Field label="Font">
            <Select value={s.subtitles.font} onChange={(e) => onChange(patch(s, "subtitles", { font: e.target.value }))}>
              {["Arial Black", "Arial", "Helvetica", "Impact", "Verdana", "Georgia"].map((f) => (
                <option key={f}>{f}</option>
              ))}
            </Select>
          </Field>
          <Range label="Size" value={s.subtitles.font_size} min={40} max={160} step={4} format={(v) => `${v}`} onChange={(v) => onChange(patch(s, "subtitles", { font_size: v }))} />
          <Range label="Outline" value={s.subtitles.outline_px} min={0} max={12} step={1} format={(v) => (v ? `${v}px` : "None")} onChange={(v) => onChange(patch(s, "subtitles", { outline_px: v }))} />
          <Row label="Position">
            <Segmented size="sm" label="Position" value={s.subtitles.position} onChange={(v) => onChange(patch(s, "subtitles", { position: v }))} options={[{ value: "top", label: "Top" }, { value: "center", label: "Middle" }, { value: "bottom", label: "Bottom" }]} />
          </Row>
          <div className="grid grid-cols-3 gap-2">
            <Colour label="Text" value={s.subtitles.text_hex} onChange={(v) => onChange(patch(s, "subtitles", { text_hex: v }))} />
            <Colour label="Highlight" value={s.subtitles.highlight_hex} onChange={(v) => onChange(patch(s, "subtitles", { highlight_hex: v }))} />
            <Colour label="Outline" value={s.subtitles.outline_hex} onChange={(v) => onChange(patch(s, "subtitles", { outline_hex: v }))} />
          </div>
          <SwitchRow label="Capital letters" checked={s.subtitles.uppercase} onChange={(v) => onChange(patch(s, "subtitles", { uppercase: v }))} />
          <Field label="Deliver as">
            <Select value={s.subtitles.delivery} onChange={(e) => onChange(patch(s, "subtitles", { delivery: e.target.value as ShortVideoSettings["subtitles"]["delivery"] }))}>
              <option value="burned">In the video</option>
              <option value="both">In the video, plus SRT and VTT files</option>
              <option value="sidecar">SRT and VTT files only</option>
            </Select>
          </Field>
        </Group>

        <Group title="Music and voice">
          <Range label="Music volume" value={s.music.volume_db} min={-36} max={-6} step={1} format={(v) => `${v} dB`} onChange={(v) => onChange(patch(s, "music", { volume_db: v }))} />
          <SwitchRow label="Lower the music while the voice speaks" checked={s.music.duck} onChange={(v) => onChange(patch(s, "music", { duck: v }))} />
          <Field label="Music mood" hint="Leave empty to match the topic.">
            <Input value={s.music.mood} maxLength={120} placeholder="calm lo-fi" onChange={(e) => onChange(patch(s, "music", { mood: e.target.value }))} />
          </Field>
          <Field label="Tone of the narration" hint="Your brand voice is used too.">
            <Input value={s.look.tone} maxLength={200} placeholder="Warm and quick, like a friend explaining" onChange={(e) => onChange(patch(s, "look", { tone: e.target.value }))} />
          </Field>
        </Group>
      </div>
    </Sheet>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[12px] font-medium text-fg-faint">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[12.5px] font-medium text-fg">{label}</span>
      {children}
    </div>
  );
}

function Range({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center justify-between text-[12.5px]">
        <span className="font-medium text-fg">{label}</span>
        <span className="text-fg-muted tabular">{format(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-ds-accent" />
    </label>
  );
}

function Colour({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[12.5px] font-medium text-fg">{label}</span>
      <span className="flex h-8 items-center gap-2 rounded-ds-md border border-hairline bg-surface-2 px-2">
        {/* The person's chosen subtitle colour: content, not chrome. */}
        <input type="color" aria-label={`${label} colour`} value={`#${value}`} onChange={(e) => onChange(e.target.value.slice(1).toUpperCase())} className="size-5 shrink-0 cursor-pointer rounded-ds-xs border-0 bg-transparent p-0" />
        <span className="truncate text-[12px] text-fg-muted tabular">{value}</span>
      </span>
    </label>
  );
}
