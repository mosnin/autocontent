"use client";

import * as React from "react";
import { useActionState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ElasticSlider } from "@/components/elastic-slider";
import { estimateVideoCostUsd } from "@/lib/cost-estimator";
import { updateUserSettingsAction } from "@/lib/actions";
import { cn } from "@/lib/utils";

interface Props {
  initialCap: string | null;
}

const INITIAL_STATE = { ok: false as boolean, error: undefined as string | undefined };

// Slider range. Caps above this can still be typed into the number
// input — the slider simply pins to its max while the real submitted
// value keeps whatever was entered.
const SLIDER_MIN = 0;
const SLIDER_MAX = 100;
const SLIDER_STEP = 1;

// A representative niche, used only to translate a dollar cap into an
// intuitive "videos/day" figure. Mirrors the defaults a new niche ships
// with; the real per-niche cost varies with each niche's settings.
const REFERENCE_NICHE = {
  scene_count: 6,
  image_quality: "medium",
  video_resolution: "720p",
  scene_max_duration_sec: 5,
  target_duration_sec: 60,
} as const;

const PER_VIDEO_USD = estimateVideoCostUsd(REFERENCE_NICHE).total;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function formatUsd(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function SpendCapForm({ initialCap }: Props) {
  const [state, formAction, pending] = useActionState(
    updateUserSettingsAction,
    INITIAL_STATE,
  );

  const hasInitialCap = initialCap != null && initialCap.trim() !== "";
  const [enabled, setEnabled] = React.useState(hasInitialCap);
  // Kept as a string so partial typing ("1.", "") stays intact. The
  // number input owns the submitted value directly.
  const [cap, setCap] = React.useState(hasInitialCap ? initialCap!.trim() : "");

  React.useEffect(() => {
    if (state.ok) toast.success("Spend cap saved");
    if (!state.ok && state.error) toast.error(state.error);
  }, [state]);

  const numeric = cap === "" ? NaN : Number(cap);
  const hasValue = Number.isFinite(numeric) && numeric >= 0;
  const sliderValue = clamp(hasValue ? numeric : 0, SLIDER_MIN, SLIDER_MAX);
  const videosPerDay =
    enabled && hasValue && numeric > 0
      ? Math.floor(numeric / PER_VIDEO_USD)
      : 0;

  return (
    <form action={formAction} className="space-y-6">
      {/* Enforce toggle — off means no account-wide ceiling at all. */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label
            htmlFor="cap-enabled"
            className="text-sm font-medium leading-none"
          >
            Enforce a global daily cap
          </Label>
          <p className="max-w-md text-xs text-muted-foreground">
            An account-wide ceiling across every niche. Checked before each
            job runs. Anything that would push the day&apos;s spend over the
            cap is refused, not truncated.
          </p>
        </div>
        <Switch
          id="cap-enabled"
          checked={enabled}
          onCheckedChange={(next) => {
            setEnabled(next);
            if (next && cap === "") setCap("10");
          }}
        />
      </div>

      <Separator />

      {enabled ? (
        <div className="space-y-5">
          {/* The cap, front and centre. */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
                Daily ceiling
              </p>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-semibold text-muted-foreground">
                  $
                </span>
                <span
                  className={cn(
                    "font-mono text-5xl font-semibold tabular-nums tracking-tight",
                    hasValue ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {hasValue ? formatUsd(numeric) : "0.00"}
                </span>
                <span className="ml-1 text-sm text-muted-foreground">
                  / day
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 pb-1">
              <Badge variant="outline" size="lg" className="font-mono">
                <span className="tabular-nums">≈ {videosPerDay}</span>
                <span className="ml-1 text-muted-foreground">videos/day</span>
              </Badge>
              <span className="text-[10px] font-medium uppercase tracking-wider text-brand">
                est.
              </span>
            </div>
          </div>

          {/* Drag to set the cap. */}
          <ElasticSlider
            label="Cap"
            aria-label="Global daily spend cap in US dollars"
            min={SLIDER_MIN}
            max={SLIDER_MAX}
            step={SLIDER_STEP}
            value={sliderValue}
            onValueChange={(v) => setCap(String(v))}
            formatValue={(v) => `$${Math.round(v)}`}
          />

          {/* …or type an exact figure. This input owns the submitted value. */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="global_daily_cap_usd">Exact amount (USD)</Label>
              <div className="relative w-40">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  id="global_daily_cap_usd"
                  name="global_daily_cap_usd"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={cap}
                  onChange={(e) => setCap(e.target.value)}
                  className="pl-6 font-mono tabular-nums"
                />
              </div>
            </div>
            <p className="pb-2.5 text-xs text-muted-foreground">
              At ≈ ${formatUsd(PER_VIDEO_USD)} per video for a typical niche.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Uncapped: submit an empty value so the action clears the cap. */}
          <input type="hidden" name="global_daily_cap_usd" value="" />
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-3xl font-semibold tabular-nums text-muted-foreground">
              Uncapped
            </span>
          </div>
          <p className="max-w-md text-xs text-muted-foreground">
            No account-wide limit. Spending is bounded only by each niche&apos;s
            own per-niche cap. Turn the toggle on to set a global ceiling.
          </p>
        </div>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending} className="min-w-28">
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Saving…
            </>
          ) : (
            "Save cap"
          )}
        </Button>
      </div>
    </form>
  );
}
