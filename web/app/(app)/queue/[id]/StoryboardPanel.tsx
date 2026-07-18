"use client";

// The editable storyboard shown on a `planned` job: plan-first stopped the
// pipeline after ideation + scriptwriting so the operator can rewrite any
// scene's narration/visual/motion prompts before any image, video, or TTS
// spend happens. Saves via PUT /plan (scene count is fixed, validated
// server-side); Render continues the job through POST /render.

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Clapperboard, Loader2, Play } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { clientFetch } from "@/lib/client-fetcher";
import type { estimateVideoCostUsd } from "@/lib/cost-estimator";
import { formatUsd } from "@/lib/format";
import {
  humanizeStudioError,
  jobPlanKey,
  renderJob,
  updateJobPlan,
  type JobPlan,
} from "@/lib/studio-client";

type EditableScene = {
  narration: string;
  visual_prompt: string;
  motion_prompt: string;
};

export function StoryboardPanel({
  jobId,
  breakdown,
  onRendered,
}: {
  jobId: string;
  breakdown: ReturnType<typeof estimateVideoCostUsd> | null;
  onRendered: () => void;
}) {
  const { data: plan, mutate, isLoading, error } = useSWR<JobPlan>(
    jobPlanKey(jobId),
    clientFetch,
  );

  const [edited, setEdited] = React.useState<Record<number, EditableScene> | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [rendering, setRendering] = React.useState(false);

  // Seed local edit state from the fetched plan exactly once — after that,
  // the operator's edits are the source of truth until Save round-trips.
  React.useEffect(() => {
    if (plan && edited === null) {
      const initial: Record<number, EditableScene> = {};
      for (const s of plan.scenes) {
        initial[s.index] = {
          narration: s.narration,
          visual_prompt: s.visual_prompt,
          motion_prompt: s.motion_prompt,
        };
      }
      setEdited(initial);
    }
  }, [plan, edited]);

  function updateField(index: number, field: keyof EditableScene, value: string) {
    setEdited((prev) => (prev ? { ...prev, [index]: { ...prev[index], [field]: value } } : prev));
  }

  const dirty =
    !!plan &&
    !!edited &&
    plan.scenes.some((s) => {
      const e = edited[s.index];
      return (
        !!e &&
        (e.narration !== s.narration ||
          e.visual_prompt !== s.visual_prompt ||
          e.motion_prompt !== s.motion_prompt)
      );
    });

  const hasEmptyField =
    !!edited &&
    Object.values(edited).some(
      (s) => !s.narration.trim() || !s.visual_prompt.trim() || !s.motion_prompt.trim(),
    );

  async function onSave() {
    if (!plan || !edited) return;
    setSaving(true);
    try {
      const scenes = plan.scenes.map((s) => ({ index: s.index, ...edited[s.index] }));
      const updated = await updateJobPlan(jobId, scenes);
      await mutate(updated, false);
      toast.success("Storyboard saved");
    } catch (e) {
      toast.error(humanizeStudioError(e));
    } finally {
      setSaving(false);
    }
  }

  async function onRender() {
    setRendering(true);
    try {
      await renderJob(jobId);
      toast.success("Rendering started");
      onRendered();
    } catch (e) {
      toast.error(humanizeStudioError(e));
    } finally {
      setRendering(false);
    }
  }

  return (
    <Card className="border-brand/30">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clapperboard className="size-4 text-brand" aria-hidden />
            <CardTitle className="text-base">Storyboard</CardTitle>
            <Badge variant="outline" className="border-brand/50 text-brand">
              Awaiting your review
            </Badge>
          </div>
          {breakdown && (
            <span className="text-xs text-muted-foreground">
              Estimated render cost:{" "}
              <span className="font-mono tabular-nums text-foreground">
                {formatUsd(breakdown.total)}
              </span>
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {plan && (
          <div className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">Hook:</span>{" "}
              <span className="italic">&ldquo;{plan.hook}&rdquo;</span>
            </p>
            <p className="text-muted-foreground">{plan.topic}</p>
          </div>
        )}

        {error ? (
          <p className="text-sm text-destructive">
            {humanizeStudioError(error)}
          </p>
        ) : isLoading || !plan || !edited ? (
          <div className="flex h-24 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <ol className="space-y-4">
            {plan.scenes.map((s) => {
              const e = edited[s.index];
              return (
                <li key={s.index} className="space-y-2.5 rounded-md border p-3">
                  <div className="flex items-baseline justify-between">
                    <Badge variant="outline" className="font-mono">
                      scene {s.index + 1}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {s.duration_sec.toFixed(1)}s
                    </span>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`narration-${s.index}`} className="text-xs">
                      Narration
                    </Label>
                    <Textarea
                      id={`narration-${s.index}`}
                      value={e.narration}
                      onChange={(ev) => updateField(s.index, "narration", ev.target.value)}
                      rows={2}
                      maxLength={1000}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`visual-${s.index}`} className="text-xs">
                      Visual prompt
                    </Label>
                    <Textarea
                      id={`visual-${s.index}`}
                      value={e.visual_prompt}
                      onChange={(ev) => updateField(s.index, "visual_prompt", ev.target.value)}
                      rows={2}
                      maxLength={2000}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`motion-${s.index}`} className="text-xs">
                      Motion prompt
                    </Label>
                    <Textarea
                      id={`motion-${s.index}`}
                      value={e.motion_prompt}
                      onChange={(ev) => updateField(s.index, "motion_prompt", ev.target.value)}
                      rows={2}
                      maxLength={2000}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
          <div className="space-y-1">
            <Button
              variant="outline"
              onClick={onSave}
              disabled={!dirty || saving || hasEmptyField || !plan}
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
            {hasEmptyField && (
              <p className="text-xs text-brand">
                Every scene needs narration, a visual prompt, and a motion
                prompt.
              </p>
            )}
            {dirty && !hasEmptyField && (
              <p className="text-xs text-muted-foreground">Unsaved changes.</p>
            )}
          </div>
          <Button
            size="lg"
            onClick={onRender}
            disabled={rendering || dirty || !plan || hasEmptyField}
            isLoading={rendering}
          >
            <Play className="size-4" aria-hidden />
            Render video
          </Button>
        </div>
        {dirty && !hasEmptyField && (
          <p className="text-right text-xs text-muted-foreground">
            Save your edits before rendering.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
