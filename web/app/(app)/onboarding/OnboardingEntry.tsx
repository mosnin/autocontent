"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
// Textarea has no square/ui counterpart the template prescribes here - kept
// on the app primitive (established precedent).
import { Textarea } from "@/components/ui/textarea";
import { draftNicheAction, type NicheDraft } from "@/lib/actions";
import type { NicheDraftPrefill } from "./OnboardingForm";
import { OnboardingForm } from "./OnboardingForm";

const EXAMPLES = [
  "claymation videos explaining economics for curious adults",
  "eerie 60-second horror stories with a whispered narrator",
  "70s-film-grain history facts nobody teaches in school",
];

/**
 * The front door. Instead of a 16-field spec sheet, the user describes
 * their channel in a sentence; the model drafts every creative field and
 * drops them straight into the wizard's step 3 (schedule + cap) - the
 * only things a human should still decide. "Fill it in myself" reveals
 * the full wizard cold for power users.
 */
export function OnboardingEntry() {
  const [mode, setMode] = React.useState<"door" | "wizard">("door");
  const [prefill, setPrefill] = React.useState<NicheDraftPrefill | undefined>();
  const [startStep, setStartStep] = React.useState<1 | 3>(1);
  const [text, setText] = React.useState("");
  const [drafting, setDrafting] = React.useState(false);

  async function generate() {
    const description = text.trim();
    if (description.length < 8) {
      toast.error("Describe your channel in a sentence first");
      return;
    }
    setDrafting(true);
    const res = await draftNicheAction(description);
    setDrafting(false);
    if (!res.ok) {
      toast.error(res.error || "Couldn't draft a channel - try the manual form");
      return;
    }
    setPrefill(toPrefill(res.draft));
    setStartStep(3); // creative fields are filled; land on schedule + cap
    setMode("wizard");
    toast.success("Drafted your channel - review and launch");
  }

  if (mode === "wizard") {
    return (
      <div className="space-y-4">
        {prefill && (
          <div className="rounded-3xl border border-border bg-muted/50 px-4 py-2.5 text-sm text-muted-foreground">
            Drafted from your description - tweak anything, then set the schedule
            and cap.
          </div>
        )}
        <OnboardingForm prefill={prefill} startStep={startStep} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="border-border rounded-3xl border p-6 sm:p-8">
        <label
          htmlFor="channel-sentence"
          className="text-sm font-medium text-foreground"
        >
          Describe your channel in one sentence
        </label>
        <Textarea
          id="channel-sentence"
          className="mt-3 min-h-24 resize-none text-base"
          disabled={drafting}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") generate();
          }}
          placeholder="e.g. claymation videos explaining economics for curious adults"
          value={text}
        />

        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              className="focus-ring border-border text-muted-foreground hover:text-foreground rounded-full border px-3 py-1 text-xs transition-colors"
              disabled={drafting}
              key={ex}
              onClick={() => setText(ex)}
              type="button"
            >
              {ex}
            </button>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button className="h-13 rounded-full px-8" disabled={drafting} onClick={generate} pill size="xl">
            {drafting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Drafting your channel…
              </>
            ) : (
              "Draft my channel"
            )}
          </Button>
          <Button
            className="rounded-full"
            disabled={drafting}
            onClick={() => {
              setPrefill(undefined);
              setStartStep(1);
              setMode("wizard");
            }}
            size="lg"
            variant="ghost"
          >
            Fill it in myself
          </Button>
        </div>
      </div>
    </div>
  );
}

function toPrefill(d: NicheDraft): NicheDraftPrefill {
  return {
    title: d.title,
    description: d.description,
    target_audience: d.target_audience,
    hashtags: d.hashtags,
    visual_style: d.visual_style,
    voice: d.voice as NicheDraftPrefill["voice"],
    target_duration_sec: d.target_duration_sec,
    scene_count: d.scene_count,
    image_quality: d.image_quality,
    video_resolution: d.video_resolution,
    scene_max_duration_sec: d.scene_max_duration_sec,
    tts_style_directions: d.tts_style_directions,
    character_description: d.character_description,
  };
}
