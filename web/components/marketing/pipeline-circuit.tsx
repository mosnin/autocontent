"use client";

import * as React from "react";
import {
  AudioWaveform,
  BarChart3,
  Clapperboard,
  ImageIcon,
  Lightbulb,
  PenLine,
  Send,
  SlidersHorizontal,
} from "lucide-react";

import { CircuitBoard } from "@/components/ui/circuit-board";
import { cn } from "@/lib/utils";

/**
 * The autocontent pipeline rendered as a live circuit. This is the product
 * diagram: idea -> script -> keyframes -> motion -> voice -> mix -> post,
 * with the analytics trace feeding back into ideation (the closed loop).
 *
 * Two variants:
 *  - "full"    hero-scale, all eight stages + feedback trace
 *  - "loop"    compact four-node closed loop for the optimization section
 */

const FULL_NODES = [
  { id: "idea", x: 60, y: 200, label: "Ideate", icon: <Lightbulb className="size-4" />, status: "active" as const, size: "lg" as const },
  { id: "script", x: 185, y: 120, label: "Script", icon: <PenLine className="size-4" />, status: "processing" as const },
  { id: "frames", x: 310, y: 80, label: "Keyframes", icon: <ImageIcon className="size-4" />, status: "processing" as const },
  { id: "motion", x: 435, y: 120, label: "Animate", icon: <Clapperboard className="size-4" />, status: "processing" as const },
  { id: "voice", x: 310, y: 200, label: "Voice", icon: <AudioWaveform className="size-4" />, status: "processing" as const },
  { id: "mix", x: 560, y: 200, label: "Mix", icon: <SlidersHorizontal className="size-4" />, status: "processing" as const },
  { id: "post", x: 685, y: 160, label: "Post", icon: <Send className="size-4" />, status: "active" as const, size: "lg" as const },
  { id: "signal", x: 372, y: 320, label: "Analytics", icon: <BarChart3 className="size-4" />, status: "active" as const },
];

const FULL_CONNECTIONS = [
  { from: "idea", to: "script", animated: true },
  { from: "script", to: "frames", animated: true },
  { from: "frames", to: "motion", animated: true },
  { from: "script", to: "voice", animated: true },
  { from: "motion", to: "mix", animated: true },
  { from: "voice", to: "mix", animated: true },
  { from: "mix", to: "post", animated: true },
  { from: "post", to: "signal", animated: true },
  // The trace that makes it a loop: performance data tunes the next idea.
  { from: "signal", to: "idea", animated: true, bidirectional: false },
];

export function PipelineCircuit({ className }: { className?: string }) {
  return (
    <div className={cn("relative w-full overflow-hidden", className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10 [background:radial-gradient(ellipse_at_center,transparent_55%,hsl(var(--background))_98%)]"
      />
      <CircuitBoard
        aria-label="The autocontent pipeline: ideate, script, keyframes, animate, voice, mix, post — with analytics feeding back into ideation"
        className="mx-auto w-full max-w-4xl"
        connections={FULL_CONNECTIONS}
        height={400}
        nodes={FULL_NODES}
        pulseColor="hsl(var(--brand))"
        pulseSpeed={2.4}
        showGrid
        width={760}
      />
    </div>
  );
}

const LOOP_NODES = [
  { id: "make", x: 200, y: 60, label: "Make", icon: <Clapperboard className="size-4" />, status: "processing" as const },
  { id: "ship", x: 340, y: 160, label: "Ship", icon: <Send className="size-4" />, status: "active" as const },
  { id: "measure", x: 200, y: 260, label: "Measure", icon: <BarChart3 className="size-4" />, status: "processing" as const },
  { id: "learn", x: 60, y: 160, label: "Learn", icon: <Lightbulb className="size-4" />, status: "active" as const },
];

const LOOP_CONNECTIONS = [
  { from: "make", to: "ship", animated: true },
  { from: "ship", to: "measure", animated: true },
  { from: "measure", to: "learn", animated: true },
  { from: "learn", to: "make", animated: true },
];

export function LoopCircuit({ className }: { className?: string }) {
  return (
    <CircuitBoard
      aria-label="The closed loop: make, ship, measure, learn"
      className={cn("mx-auto", className)}
      connections={LOOP_CONNECTIONS}
      height={320}
      nodes={LOOP_NODES}
      pulseColor="hsl(var(--brand))"
      pulseSpeed={3}
      showGrid={false}
      width={400}
    />
  );
}
