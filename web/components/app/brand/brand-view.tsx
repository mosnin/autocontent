"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState } from "react";
import { AskPill, Button, Callout, Card, Column, Field, Input, Notice, PageHeader, Section, TagInput, Textarea } from "@/design-system";
import { EMPTY_BRAND_KIT, HEX_COLOR_RE, saveBrandKit, type BrandKit } from "@/lib/brand-kit-client";
import { formatDateTime } from "@/lib/format";
import type { Kit } from "@/lib/types";
import { Kits } from "./kits";

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message.replace(/^\d+\s*/, "") || "Couldn't save";
  return "Something went wrong";
}

/** A labelled group for controls that aren't a single input (tag inputs, colour). */
function FieldGroup({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="block text-[12.5px] font-medium text-fg">{label}</span>
      {children}
      {hint && <span className="block text-[12px] text-fg-muted">{hint}</span>}
    </div>
  );
}

// The native colour input only accepts a hex value.
const PICKER_DEFAULT = "#8a8a8a"; // ds-guard-ignore

const ASK = `/sessions/new?dept=strategy&q=${encodeURIComponent("Read my website and draft our brand voice, audience and banned words")}`;

/** Brand (ref 07, column md): voice, audience and visual kit in one form, then the kits agents carry. */
export function BrandView({ kit, kits, loadFailed }: { kit: BrandKit | null; kits: Kit[] | null; loadFailed?: boolean }) {
  return (
    <>
      <PageHeader icon={<Sparkles />} title="Brand" />
      <Column title="Brand" description="How every agent sounds, who it writes for, and how it looks.">
        {loadFailed && <Callout tone="attention">Couldn't load your saved brand, so this starts blank. Saving overwrites it.</Callout>}
        <BrandForm initial={kit ?? EMPTY_BRAND_KIT} />
        <Kits kits={kits} />
        <AskPill label="Ask Marketer to draft your voice" href={ASK} />
      </Column>
    </>
  );
}

function BrandForm({ initial }: { initial: BrandKit }) {
  const router = useRouter();
  const [brandName, setBrandName] = useState(initial.brand_name);
  const [tagline, setTagline] = useState(initial.tagline);
  const [tone, setTone] = useState(initial.tone_of_voice);
  const [audience, setAudience] = useState(initial.target_audience);
  const [banned, setBanned] = useState<string[]>(initial.banned_words);
  const [hashtags, setHashtags] = useState<string[]>(initial.preferred_hashtags.map((t) => t.replace(/^#+/, "")));
  const [color, setColor] = useState(initial.color_hex);
  const [savedAt, setSavedAt] = useState(initial.updated_at);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok?: string; error?: string } | null>(null);

  const hexValid = color === "" || HEX_COLOR_RE.test(color);
  const swatch = HEX_COLOR_RE.test(color) ? color : null;

  function onHexText(v: string) {
    let s = v.trim();
    if (s && !s.startsWith("#")) s = `#${s}`;
    setColor(s);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const hex = color.trim();
    if (hex !== "" && !HEX_COLOR_RE.test(hex)) {
      setNote({ error: "Brand colour must be a 6-digit hex like #1a2b3c, or empty." });
      return;
    }
    setSaving(true);
    setNote(null);
    try {
      const saved = await saveBrandKit({
        brand_name: brandName.trim(),
        tagline: tagline.trim(),
        tone_of_voice: tone.trim(),
        target_audience: audience.trim(),
        banned_words: banned,
        preferred_hashtags: hashtags.map((t) => `#${t}`),
        color_hex: hex,
      });
      setColor(saved.color_hex);
      setHashtags(saved.preferred_hashtags.map((t) => t.replace(/^#+/, "")));
      setSavedAt(saved.updated_at);
      setNote({ ok: "Saved. New drafts follow it from now on." });
      router.refresh();
    } catch (err) {
      setNote({ error: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-10">
      <Section title="Voice">
        <Card className="space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Brand name">
              <Input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Pasta Club" />
            </Field>
            <Field label="Tagline">
              <Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Ship content on autopilot." />
            </Field>
          </div>
          <Field label="Tone of voice" hint="Passed to every writer as written.">
            <Textarea rows={3} value={tone} onChange={(e) => setTone(e.target.value)} placeholder="Warm, practical, no hype" />
          </Field>
          <FieldGroup label="Banned words" hint="Comma or Enter adds one.">
            <TagInput id="brand-banned" values={banned} onChange={setBanned} placeholder="disrupt, revolutionary, synergy" />
          </FieldGroup>
        </Card>
      </Section>

      <Section title="Audience">
        <Card className="space-y-4 p-4">
          <Field label="Who it's for">
            <Input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Solo founders and small marketing teams" />
          </Field>
          <FieldGroup label="Hashtags" hint="Seeded into new channels. The # is added for you.">
            <TagInput id="brand-hashtags" values={hashtags} onChange={setHashtags} placeholder="marketing, growth, saas" prefix="#" />
          </FieldGroup>
        </Card>
      </Section>

      <Section title="Visual kit">
        <Card className="p-4">
          <FieldGroup label="Brand colour" hint={hexValid ? "A 6-digit hex, or empty for none." : "Enter a 6-digit hex like #4f46e5, or clear it."}>
            <div className="flex flex-wrap items-center gap-2">
              <input type="color" aria-label="Pick brand colour" value={swatch ?? PICKER_DEFAULT} onChange={(e) => setColor(e.target.value)} className="h-8 w-10 shrink-0 cursor-pointer rounded-ds-md border border-hairline bg-surface-2 p-1" />
              <div className="w-32">
                <Input value={color} onChange={(e) => onHexText(e.target.value)} placeholder="4F46E5" spellCheck={false} autoCapitalize="off" aria-label="Brand colour hex" aria-invalid={!hexValid} className="font-mono uppercase" />
              </div>
              {color !== "" && (
                <Button size="sm" variant="ghost" onClick={() => setColor("")}>
                  Clear
                </Button>
              )}
            </div>
          </FieldGroup>
        </Card>
      </Section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Notice ok={note?.ok} error={note?.error} />
          {!note && <p className="text-[12.5px] text-fg-muted">{savedAt ? `Last saved ${formatDateTime(savedAt)}` : "Not saved yet"}</p>}
        </div>
        <Button type="submit" variant="primary" loading={saving}>
          Save brand
        </Button>
      </div>
    </form>
  );
}
