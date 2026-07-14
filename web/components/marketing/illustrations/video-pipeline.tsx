"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { VIEWPORT } from "@/components/marketing/system/motion";

/**
 * The video pipeline: idea → script → frames + voice → publish, with the
 * learn trace looping back underneath. Line-art nodes, path draw-in, a
 * traveling brand pulse.
 *
 * `stage` (0-4) turns it into a scroll-driven diagram: nodes light up per
 * stage (0 Ideate, 1 Script, 2 Render, 3 Publish, 4 Learn). Omit `stage`
 * for the self-running ambient version.
 */

type NodeSpec = {
  id: string;
  x: number;
  y: number;
  label: string;
  stage: number;
  glyph: React.ReactNode;
};

const NODES: NodeSpec[] = [
  {
    id: "idea",
    x: 70,
    y: 130,
    label: "Idea",
    stage: 0,
    glyph: (
      <path d="M0 -7 V-3 M0 3 V7 M-7 0 H-3 M3 0 H7 M-4.5 -4.5 L-2 -2 M2 2 L4.5 4.5 M-4.5 4.5 L-2 2 M2 -2 L4.5 -4.5" />
    ),
  },
  {
    id: "script",
    x: 200,
    y: 130,
    label: "Script",
    stage: 1,
    glyph: <path d="M-6 -4 H6 M-6 0 H6 M-6 4 H2" />,
  },
  {
    id: "frames",
    x: 340,
    y: 70,
    label: "Frames",
    stage: 2,
    glyph: (
      <path d="M-7 -5 H3 V3 H-7 Z M-3 -1 H7 V7 H-3" fill="none" />
    ),
  },
  {
    id: "voice",
    x: 340,
    y: 190,
    label: "Voice",
    stage: 2,
    glyph: <path d="M-6 -2 V2 M-2 -6 V6 M2 -4 V4 M6 -1 V1" />,
  },
  {
    id: "publish",
    x: 480,
    y: 130,
    label: "Publish",
    stage: 3,
    glyph: <path d="M0 6 V-6 M-5 -1 L0 -6 L5 -1" />,
  },
];

const EDGES: Array<{ d: string; stage: number }> = [
  { d: "M 94 130 H 176", stage: 1 },
  { d: "M 220 119 C 264 100 292 84 316 75", stage: 2 },
  { d: "M 220 141 C 264 160 292 176 316 185", stage: 2 },
  { d: "M 364 75 C 402 84 436 108 458 119", stage: 3 },
  { d: "M 364 185 C 402 176 436 152 458 141", stage: 3 },
];

/** The learn trace: publish loops back to idea under the board. */
const LEARN_PATH = "M 480 156 C 480 236 70 236 70 156";

export function VideoPipelineIllustration({
  className,
  stage,
}: {
  className?: string;
  /** 0 Ideate · 1 Script · 2 Render · 3 Publish · 4 Learn. */
  stage?: number;
}) {
  const reduced = useReducedMotion();
  const driven = stage !== undefined;
  const active = (s: number) => !driven || (stage ?? 0) >= s;
  const isCurrent = (s: number) =>
    driven && (s === stage || (stage === 4 && s === 0));

  return (
    <motion.svg
      aria-label="Pipeline diagram: idea to script to frames and voice to publish, with learnings looping back to the next idea"
      className={cn("h-auto w-full", className)}
      initial={reduced ? false : "hidden"}
      role="img"
      viewBox="0 0 640 260"
      viewport={VIEWPORT}
      whileInView="show"
    >
      <motion.g
        animate={
          reduced ? undefined : { y: [0, -4, 0] }
        }
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
      >
        {/* Edges */}
        {EDGES.map((e, i) => (
          <motion.path
            className={cn(
              "transition-[stroke] duration-500",
              active(e.stage) ? "stroke-zinc-400" : "stroke-zinc-200",
            )}
            custom={i}
            d={e.d}
            fill="none"
            key={e.d}
            strokeWidth={1.5}
            variants={{
              hidden: { pathLength: 0, opacity: 0 },
              show: (n: number) => ({
                pathLength: 1,
                opacity: 1,
                transition: {
                  pathLength: {
                    duration: 0.8,
                    ease: "easeInOut",
                    delay: 0.2 + n * 0.12,
                  },
                  opacity: { duration: 0.2, delay: 0.2 + n * 0.12 },
                },
              }),
            }}
          />
        ))}

        {/* Learn trace */}
        <motion.path
          className={cn(
            "transition-[stroke] duration-500",
            driven && stage === 4 ? "stroke-zinc-500" : "stroke-zinc-300",
          )}
          d={LEARN_PATH}
          fill="none"
          strokeDasharray="4 7"
          strokeLinecap="round"
          strokeWidth={1.5}
          variants={{
            hidden: { pathLength: 0, opacity: 0 },
            show: {
              pathLength: 1,
              opacity: 1,
              transition: {
                pathLength: { duration: 1.1, ease: "easeInOut", delay: 0.9 },
                opacity: { duration: 0.2, delay: 0.9 },
              },
            },
          }}
        />
        <text
          className={cn(
            "text-[11px] font-medium transition-[fill] duration-500",
            driven && stage === 4 ? "fill-zinc-700" : "fill-zinc-400",
          )}
          textAnchor="middle"
          x={275}
          y={230}
        >
          learnings feed the next idea
        </text>

        {/* Nodes */}
        {NODES.map((n, i) => {
          const on = active(n.stage);
          const current = isCurrent(n.stage);
          return (
            <motion.g
              custom={i}
              key={n.id}
              variants={{
                hidden: { opacity: 0, scale: 0.7 },
                show: (idx: number) => ({
                  opacity: 1,
                  scale: 1,
                  transition: {
                    duration: 0.5,
                    ease: [0.22, 1, 0.36, 1],
                    delay: 0.15 + idx * 0.12,
                  },
                }),
              }}
            >
              <circle
                className={cn(
                  "transition-[fill,stroke] duration-500",
                  on
                    ? "fill-sky-50 stroke-zinc-800"
                    : "fill-white stroke-zinc-300",
                )}
                cx={n.x}
                cy={n.y}
                r={22}
                strokeWidth={1.5}
              />
              <g
                className={cn(
                  "transition-[stroke] duration-500",
                  on ? "stroke-zinc-800" : "stroke-zinc-400",
                )}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                transform={`translate(${n.x} ${n.y})`}
              >
                {n.glyph}
              </g>
              <text
                className={cn(
                  "text-[11px] font-medium transition-[fill] duration-500",
                  on ? "fill-zinc-700" : "fill-zinc-400",
                )}
                textAnchor="middle"
                x={n.x}
                y={n.y + 40}
              >
                {n.label}
              </text>
              {/* The recording light on the currently-active stage. */}
              {current && !reduced && (
                <motion.circle
                  animate={{ scale: [1, 1.8], opacity: [0.6, 0] }}
                  className="fill-brand"
                  cx={n.x + 17}
                  cy={n.y - 17}
                  r={4}
                  transition={{
                    duration: 1.4,
                    repeat: Infinity,
                    ease: "easeOut",
                  }}
                />
              )}
              {current && (
                <circle
                  className="fill-brand"
                  cx={n.x + 17}
                  cy={n.y - 17}
                  r={3.5}
                />
              )}
            </motion.g>
          );
        })}

        {/* Ambient traveling pulse (self-running mode only). */}
        {!driven && !reduced && (
          <motion.circle
            animate={{
              cx: [70, 200, 340, 480, 275, 70],
              cy: [130, 130, 70, 130, 216, 130],
              opacity: [0, 1, 1, 1, 0.7, 0],
            }}
            className="fill-brand"
            r={3.5}
            transition={{
              duration: 6,
              repeat: Infinity,
              ease: "linear",
              times: [0, 0.2, 0.4, 0.6, 0.82, 1],
              delay: 1.4,
            }}
          />
        )}
      </motion.g>
    </motion.svg>
  );
}
