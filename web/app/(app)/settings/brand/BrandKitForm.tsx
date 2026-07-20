"use client";

// Single-page settings form for the workspace Brand Kit. Fields are controlled
// (there is no server action — the write is a client PUT through the proxy, like
// the webhooks surface), and the current kit is kept fresh via SWR with the
// server-rendered kit as fallbackData. Every field is explicitly labelled and
// associated with its control.

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/client-fetcher";
import { cn } from "@/lib/utils";
import {
  BRAND_KIT_KEY,
  HEX_COLOR_RE,
  brandKitFetcher,
  saveBrandKit,
  type BrandKit,
} from "@/lib/brand-kit-client";

// Swatch fallback shown when no colour has been chosen yet — native color
// inputs can't be empty, so we render a neutral grey while color_hex stays "".
const UNSET_SWATCH = "#3f3f46";

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    return e.message.replace(/^\d+\s*/, "") || `Request failed (${e.status})`;
  }
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}

export function BrandKitForm({ initial }: { initial: BrandKit }) {
  // SWR keeps the canonical kit fresh (and lets us seed the cache post-save).
  // The form itself is owned by local state, seeded once from the server data
  // so in-flight edits are never clobbered by a background revalidation.
  const { data, mutate } = useSWR<BrandKit>(BRAND_KIT_KEY, brandKitFetcher, {
    fallbackData: initial,
    revalidateOnFocus: false,
  });
  const kit = data ?? initial;

  const [brandName, setBrandName] = React.useState(initial.brand_name);
  const [tagline, setTagline] = React.useState(initial.tagline);
  const [toneOfVoice, setToneOfVoice] = React.useState(initial.tone_of_voice);
  const [targetAudience, setTargetAudience] = React.useState(
    initial.target_audience,
  );
  const [bannedWords, setBannedWords] = React.useState<string[]>(
    initial.banned_words,
  );
  const [hashtags, setHashtags] = React.useState<string[]>(
    initial.preferred_hashtags,
  );
  const [colorHex, setColorHex] = React.useState(initial.color_hex);
  const [saving, setSaving] = React.useState(false);

  const hexValid = colorHex === "" || HEX_COLOR_RE.test(colorHex);
  const swatchValue = HEX_COLOR_RE.test(colorHex) ? colorHex : UNSET_SWATCH;
  const previewColor = HEX_COLOR_RE.test(colorHex) ? colorHex : undefined;

  // Free-typed hex: forgive a missing leading '#', keep the rest verbatim so a
  // half-typed value doesn't fight the user. Full validation happens on submit.
  function handleHexText(v: string) {
    let s = v.trim();
    if (s && !s.startsWith("#")) s = `#${s}`;
    setColorHex(s);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;

    const hex = colorHex.trim();
    if (hex !== "" && !HEX_COLOR_RE.test(hex)) {
      toast.error("Brand colour must be a 6-digit hex like #1a2b3c, or empty.");
      return;
    }

    setSaving(true);
    try {
      const saved = await saveBrandKit({
        brand_name: brandName.trim(),
        tagline: tagline.trim(),
        tone_of_voice: toneOfVoice.trim(),
        target_audience: targetAudience.trim(),
        banned_words: bannedWords,
        // Auto-prefix '#'; the server normalizes too, but sending it clean keeps
        // the returned value predictable.
        preferred_hashtags: hashtags.map((t) => `#${t}`),
        color_hex: hex,
      });
      // Seed the SWR cache with the authoritative response and resync the
      // fields (color_hex may have been normalized server-side).
      await mutate(saved, { revalidate: false });
      setColorHex(saved.color_hex);
      setHashtags(saved.preferred_hashtags.map((t) => t.replace(/^#+/, "")));
      toast.success("Brand kit saved");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <SectionCard
        kicker="Identity"
        title="Name & positioning"
        description="How the brand refers to itself and who it's speaking to."
      >
        <Labelled label="Brand name" htmlFor="brand-name">
          <Input
            id="brand-name"
            name="brand_name"
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            placeholder="marketer.sh"
          />
        </Labelled>

        <Labelled
          label="Tagline"
          hint="A short line that sums up the brand."
          htmlFor="brand-tagline"
        >
          <Input
            id="brand-tagline"
            name="tagline"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="Ship content on autopilot."
          />
        </Labelled>

        <Labelled
          label="Target audience"
          hint="Who the content is ultimately for."
          htmlFor="brand-target-audience"
        >
          <Input
            id="brand-target-audience"
            name="target_audience"
            value={targetAudience}
            onChange={(e) => setTargetAudience(e.target.value)}
            placeholder="Solo founders and small marketing teams"
          />
        </Labelled>
      </SectionCard>

      <SectionCard
        kicker="Voice & look"
        title="Tone, keywords & colour"
        description="The guardrails that steer every generated draft."
      >
        <Labelled
          label="Tone of voice"
          hint="Describe how the brand should sound. Passed to the model verbatim."
          htmlFor="brand-tone"
        >
          <Textarea
            id="brand-tone"
            name="tone_of_voice"
            rows={3}
            value={toneOfVoice}
            onChange={(e) => setToneOfVoice(e.target.value)}
            placeholder="warm, practical, no hype"
          />
        </Labelled>

        <ChipInput
          id="brand-banned-words"
          label="Banned words"
          hint="Words drafts must avoid. Comma or Enter to add · backspace on empty to remove last."
          placeholder="disrupt, revolutionary, synergy"
          values={bannedWords}
          onChange={setBannedWords}
        />

        <ChipInput
          id="brand-hashtags"
          label="Preferred hashtags"
          hint="Seeded into new channels. The '#' is added automatically."
          placeholder="marketing, growth, saas"
          prefix="#"
          values={hashtags}
          onChange={setHashtags}
        />

        {/* Colour: a native swatch and a #rrggbb text field, kept in sync. The
            visible label points at the text field (the primary editable value);
            the swatch carries its own aria-label. */}
        <div className="space-y-2">
          <Label htmlFor="brand-color-hex">Brand colour</Label>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="color"
              aria-label="Pick brand colour"
              value={swatchValue}
              onChange={(e) => setColorHex(e.target.value)}
              className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-input bg-transparent p-1"
            />
            <Input
              id="brand-color-hex"
              name="color_hex"
              value={colorHex}
              onChange={(e) => handleHexText(e.target.value)}
              placeholder="#4f46e5"
              inputMode="text"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={!hexValid}
              aria-describedby="brand-color-hint"
              className="w-40 font-mono uppercase tabular-nums"
            />
            {colorHex !== "" && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setColorHex("")}
                className="text-muted-foreground"
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}
            {/* Live preview chip in the chosen colour. */}
            <span
              className={cn(
                "ml-auto inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium",
                previewColor ? "text-white" : "text-muted-foreground",
              )}
              style={
                previewColor
                  ? { backgroundColor: previewColor, borderColor: previewColor }
                  : undefined
              }
            >
              <span
                aria-hidden="true"
                className="size-2.5 rounded-full border border-white/40"
                style={{ backgroundColor: swatchValue }}
              />
              {brandName.trim() || "Brand preview"}
            </span>
          </div>
          <p id="brand-color-hint" className="text-xs text-muted-foreground">
            {hexValid
              ? "A 6-digit hex like #4f46e5, or leave empty for no set colour."
              : "Enter a 6-digit hex like #4f46e5, or clear it."}
          </p>
        </div>
      </SectionCard>

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          {kit.updated_at
            ? `Last saved ${new Date(kit.updated_at).toLocaleString()}`
            : "Not saved yet."}
        </p>
        <Button type="submit" disabled={saving} className="min-w-36">
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Saving…
            </>
          ) : (
            "Save brand kit"
          )}
        </Button>
      </div>
    </form>
  );
}

// --- chip / tag input --------------------------------------------------

function ChipInput({
  id,
  label,
  hint,
  placeholder,
  prefix = "",
  values,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  placeholder?: string;
  /** Optional display prefix (e.g. "#"). Never stored in the value itself. */
  prefix?: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = React.useState("");

  function commit(raw: string) {
    const parts = raw
      .split(",")
      .map((s) => s.trim().replace(/^#+/, ""))
      .filter(Boolean);
    if (parts.length === 0) return;
    onChange(Array.from(new Set([...values, ...parts])));
    setDraft("");
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-input bg-transparent p-2 transition-[color,box-shadow] focus-within:border-primary focus-within:ring-[3px] focus-within:ring-ring/32 dark:bg-input/30">
        {values.map((t) => (
          <Badge key={t} variant="secondary" className="gap-1 pr-1">
            {prefix}
            {t}
            <button
              type="button"
              aria-label={`Remove ${prefix}${t}`}
              className="rounded-full p-0.5 hover:bg-muted"
              onClick={() => onChange(values.filter((x) => x !== t))}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <input
          id={id}
          className="min-w-[120px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/64"
          placeholder={values.length === 0 ? placeholder : ""}
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
              values.length > 0
            ) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => draft && commit(draft)}
        />
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// --- section scaffolding (mirrors EditNicheForm) -----------------------

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
    <Card className="border-border/60 bg-card/40">
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
