"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { HEX_COLOR_RE, saveBrandKit, type BrandKit } from "@/lib/brand-kit-client";
import { formatDateTime } from "@/lib/format";
import { MARKETER } from "@/lib/departments";
import { Panel } from "../page";
import { AgentAvatar, Button, Field, FieldGroup, Input, Textarea } from "../ui";
import { SaveNote, TagInput } from "../settings/primitives";

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message.replace(/^\d+\s*/, "") || "Couldn't save";
  return "Something went wrong";
}

/** The brand kit form, with a live card on the right showing how Marketer will sound. */
export function BrandEditor({ initial }: { initial: BrandKit }) {
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
    <form onSubmit={onSubmit} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <div className="min-w-0 space-y-5">
        <Panel label="Identity">
          <div className="space-y-4">
            <Field label="Brand name">
              <Input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Pasta Club" />
            </Field>
            <Field label="Tagline" hint="A short line that sums up the brand.">
              <Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Ship content on autopilot." />
            </Field>
            <Field label="Audience" hint="Who the content is ultimately for.">
              <Input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Solo founders and small marketing teams" />
            </Field>
          </div>
        </Panel>

        <Panel label="Voice and look">
          <div className="space-y-4">
            <Field label="Tone of voice" hint="How the brand should sound. Passed to every writer verbatim.">
              <Textarea rows={3} value={tone} onChange={(e) => setTone(e.target.value)} placeholder="Warm, practical, no hype" />
            </Field>
            <FieldGroup label="Banned words" hint="Words drafts must avoid. Comma or Enter adds one.">
              <TagInput id="brand-banned" values={banned} onChange={setBanned} placeholder="disrupt, revolutionary, synergy" />
            </FieldGroup>
            <FieldGroup label="Hashtags" hint="Seeded into new channels. The # is added for you.">
              <TagInput id="brand-hashtags" values={hashtags} onChange={setHashtags} placeholder="marketing, growth, saas" prefix="#" />
            </FieldGroup>
            <FieldGroup label="Colour" hint={hexValid ? "A 6-digit hex like #4f46e5, or empty for none." : "Enter a 6-digit hex like #4f46e5, or clear it."}>
              <div className="flex flex-wrap items-center gap-2">
                <input type="color" aria-label="Pick brand colour" value={swatch ?? "#8a8a8a"} onChange={(e) => setColor(e.target.value)} className="h-9 w-11 shrink-0 cursor-pointer rounded-lg border border-border bg-background p-1" />
                <div className="w-36"><Input value={color} onChange={(e) => onHexText(e.target.value)} placeholder="#4f46e5" spellCheck={false} autoCapitalize="off" aria-label="Brand colour hex" aria-invalid={!hexValid} className="font-mono uppercase" /></div>
                {color !== "" && (
                  <Button size="sm" variant="ghost" onClick={() => setColor("")}>
                    Clear
                  </Button>
                )}
              </div>
            </FieldGroup>
          </div>
        </Panel>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <SaveNote ok={note?.ok} error={note?.error} />
            {!note && <p className="text-[13px] text-muted-foreground">{savedAt ? `Last saved ${formatDateTime(savedAt)}` : "Not saved yet."}</p>}
          </div>
          <Button type="submit" variant="primary" loading={saving}>
            Save brand
          </Button>
        </div>
      </div>

      <BrandPreview name={brandName} tagline={tagline} tone={tone} audience={audience} banned={banned} hashtags={hashtags} color={swatch} />
    </form>
  );
}

/** A sample of what Marketer will write with this brand, updating as you type. */
function BrandPreview({ name, tagline, tone, audience, banned, hashtags, color }: { name: string; tagline: string; tone: string; audience: string; banned: string[]; hashtags: string[]; color: string | null }) {
  const brand = name.trim() || "Your brand";
  const firstTone = tone.split(/[.,;\n]/)[0]?.trim().toLowerCase();
  return (
    <aside className="min-w-0 lg:sticky lg:top-2">
      <div className="rounded-[20px] border border-border bg-subtle p-1.5">
        <div className="flex min-h-9 items-center px-3.5 pb-1.5 pt-1 text-[14px] text-muted-foreground">How Marketer will sound</div>
        <div className="space-y-4 rounded-[14px] bg-card px-5 py-4 shadow-[0_0_0_0.5px_rgb(0_0_0/0.06),0_1px_2px_rgb(0_0_0/0.04)] dark:shadow-[inset_0_0_0_1px_hsl(var(--border))]">
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full text-[14px] font-medium text-white" style={{ background: color ?? "hsl(var(--foreground) / 0.8)" }}>
              {brand.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="truncate text-[14px] font-medium">{brand}</div>
              <div className="truncate text-[12px] text-muted-foreground">{tagline.trim() || "Add a tagline"}</div>
            </div>
          </div>
          <p className="text-[14px] leading-relaxed">
            {tagline.trim() ? tagline.trim() : "Here's the one thing we'd change about your week."} {audience.trim() ? `Made for ${audience.trim().replace(/^./, (c) => c.toLowerCase())}.` : ""}
            {hashtags.length > 0 && <span className="text-accent"> {hashtags.slice(0, 3).map((h) => `#${h}`).join(" ")}</span>}
          </p>
          <div className="flex items-start gap-2.5 rounded-[14px] bg-subtle px-3 py-2.5 text-[13px] text-muted-foreground">
            <AgentAvatar name={MARKETER.name} palette={MARKETER.palette} size={22} />
            <span className="min-w-0">{firstTone ? `I'll keep it ${firstTone}` : "Tell me how you sound and I'll match it"}{audience.trim() ? `, and write for ${audience.trim().replace(/^./, (c) => c.toLowerCase())}.` : "."}</span>
          </div>
          {banned.length > 0 && (
            <div>
              <div className="mb-1.5 text-[12px] text-muted-foreground">Never says</div>
              <div className="flex flex-wrap gap-1.5">
                {banned.map((w) => (
                  <span key={w} className="inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-[12.5px] text-muted-foreground line-through decoration-destructive/60">
                    {w}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
