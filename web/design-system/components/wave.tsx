"use client";

/**
 * CommitWave: the one moment of spectacle in Marketer.
 *
 * A wave opens from the button a person just pressed and carries the thing
 * they reviewed into the thing that now exists. It is reserved for the three
 * moments where a person commits something real (see ../WAVE.md):
 *
 *   launch   a campaign goes live          full colour, in the tool's own hue
 *   approve  "Approve & Run" on a plan     quiet and quick; it happens often
 *   arrive   the first piece is ready      once per workspace
 *
 * Never use the engine (web/vendor/distortion-waves) directly, and never add
 * a fourth moment without changing WAVE.md and the guard in the same commit.
 */
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { DistortionWave } from "../../vendor/distortion-waves/src";
import type { WaveStyleInput } from "../../vendor/distortion-waves/src";
import { cx } from "../cx";
import type { ToolTone } from "./primitives";

export type WaveMoment = "launch" | "approve" | "arrive";

/** Each moment's character. Tuned once, here, so every instance feels the same. */
const MOMENTS: Record<WaveMoment, { type: "vertical" | "center"; style: WaveStyleInput; fallbackPalette: string }> = {
  // The big one: unhurried, full swell. Colour comes from the tool that is launching.
  launch: { type: "vertical", style: {}, fallbackPalette: "colorful" },
  // Frequent, so restrained: less bend, no fringe, faster travel, near-monochrome.
  approve: { type: "vertical", style: { amplitude: 0.45, aberration: 0.25, blur: 0.5, travel: 0.7, strength: 0.55, rimStrength: 0.5 }, fallbackPalette: "mono" },
  // A ring from the brand mark: the product opening up.
  arrive: { type: "center", style: {}, fallbackPalette: "colorful" },
};

/** Reads the tool's wave colour from the tokens, so colour always means "which tool did this". */
function useToneColour(root: RefObject<HTMLElement | null>, tone: ToolTone | undefined): string | undefined {
  const [hex, setHex] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!tone || !root.current) return setHex(undefined);
    const v = getComputedStyle(root.current).getPropertyValue(`--ds-wave-${tone}`).trim();
    setHex(/^#[0-9a-fA-F]{6}$/.test(v) ? v : undefined);
  }, [root, tone]);
  return hex;
}

export function CommitWave({
  moment,
  committed,
  source,
  tone,
  action,
  receipt,
  children,
  onSettled,
  className,
}: {
  moment: WaveMoment;
  /** false shows `children` (what is being reviewed); true sends the wave and shows `receipt`. */
  committed: boolean;
  /** The control that commits: the wave opens from it. Keep that control inside `action` so it stays live. */
  source?: RefObject<Element | null>;
  /** The tool this belongs to. Sets the wave's colour for `launch`. Ignored by `approve`, which stays quiet. */
  tone?: ToolTone;
  /** Stays above the wave, unbent: the committing button, a spinner. */
  action?: ReactNode;
  /** What now exists. Shown after the wave has passed. */
  receipt: ReactNode;
  children: ReactNode;
  /** Called once the wave has cleared, with the view now showing. */
  onSettled?: (committed: boolean) => void;
  className?: string;
}) {
  const probe = useRef<HTMLDivElement>(null);
  const m = MOMENTS[moment];
  const toneHex = useToneColour(probe, moment === "approve" ? undefined : tone);
  return (
    <div ref={probe} className="contents">
      <DistortionWave
        revealed={committed}
        type={m.type}
        source={source}
        palette={toneHex ?? m.fallbackPalette}
        waveStyle={m.style}
        reducedMotion="system"
        overlay={action}
        revealedContent={receipt}
        onFinish={onSettled}
        className={cx("overflow-hidden rounded-ds-lg bg-surface", className)}
      >
        {children}
      </DistortionWave>
    </div>
  );
}
