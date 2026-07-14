"use client";

import * as React from "react";
import { motion, useReducedMotion, type Variants } from "motion/react";

import { cn } from "@/lib/utils";
import { VIEWPORT } from "@/components/marketing/system/motion";

/**
 * The video pipeline: idea → script → frames + voice → publish, each stage
 * with the artifact it produces hanging off it (idea list, script lines,
 * keyframe thumbs, waveform, caption bar). The learn trace loops back on
 * its own band below the composition. Soft gradient node fills, curved
 * connectors with a traveling pulse.
 *
 * `stage` (0-4) turns it into a scroll-driven diagram: nodes light up per
 * stage (0 Ideate, 1 Script, 2 Render, 3 Publish, 4 Learn). Omit `stage`
 * for the self-running ambient version.
 */

type NodeSpec = {
  id: string;
  x: number;
  y: number;
  stage: number;
  glyph: React.ReactNode;
};

const NODES: NodeSpec[] = [
  {
    id: "idea",
    x: 72,
    y: 150,
    stage: 0,
    glyph: (
      <path d="M0 -7 V-3 M0 3 V7 M-7 0 H-3 M3 0 H7 M-4.5 -4.5 L-2 -2 M2 2 L4.5 4.5 M-4.5 4.5 L-2 2 M2 -2 L4.5 -4.5" />
    ),
  },
  {
    id: "script",
    x: 204,
    y: 150,
    stage: 1,
    glyph: <path d="M-6 -4 H6 M-6 0 H6 M-6 4 H2" />,
  },
  {
    id: "frames",
    x: 348,
    y: 84,
    stage: 2,
    glyph: <path d="M-7 -5 H3 V3 H-7 Z M-3 -1 H7 V7 H-3" fill="none" />,
  },
  {
    id: "voice",
    x: 348,
    y: 216,
    stage: 2,
    glyph: <path d="M-6 -2 V2 M-2 -6 V6 M2 -4 V4 M6 -1 V1" />,
  },
  {
    id: "publish",
    x: 492,
    y: 150,
    stage: 3,
    glyph: <path d="M0 6 V-6 M-5 -1 L0 -6 L5 -1" />,
  },
];

const EDGES: Array<{ d: string; stage: number }> = [
  { d: "M 100 150 C 126 150 152 150 176 150", stage: 1 },
  { d: "M 227 138 C 268 118 300 101 322 93", stage: 2 },
  { d: "M 227 162 C 268 182 300 199 322 207", stage: 2 },
  { d: "M 374 92 C 406 101 442 122 468 137", stage: 3 },
  { d: "M 374 208 C 406 199 442 178 468 163", stage: 3 },
];

/** The learn trace: a dedicated band below the flow, back to the idea. */
const LEARN_PATH =
  "M 492 182 C 496 258 420 312 282 312 C 144 312 68 258 72 184";

/** Waveform bar heights inside the voice chip. */
const WAVE = [6, 12, 18, 10, 22, 14, 18, 9, 13];

/** Keyframe thumbnails hanging above the frames node. */
const THUMBS = [288, 330, 372];

export function VideoPipelineIllustration({
  className,
  stage,
}: {
  className?: string;
  /** 0 Ideate · 1 Script · 2 Render · 3 Publish · 4 Learn. */
  stage?: number;
}) {
  const reduced = useReducedMotion();
  const id = React.useId();
  const driven = stage !== undefined;
  const active = (s: number) => !driven || (stage ?? 0) >= s;
  const isCurrent = (s: number) =>
    driven && (s === stage || (stage === 4 && s === 0));

  /** Shared reveal for artifact chips, staggered by stage order. */
  const chip = (delay: number): Variants => ({
    hidden: { opacity: 0, y: 8, scale: 0.96 },
    show: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1], delay },
    },
  });

  const chipClass = (s: number) =>
    cn(
      "transition-opacity duration-500",
      active(s) ? "opacity-100" : "opacity-40",
    );

  return (
    <motion.svg
      aria-label="Pipeline diagram: idea to script to frames and voice to publish, with learnings looping back into the next video"
      className={cn("h-auto w-full", className)}
      initial={reduced ? false : "hidden"}
      role="img"
      viewBox="0 0 640 360"
      viewport={VIEWPORT}
      whileInView="show"
    >
      <defs>
        <linearGradient id={`${id}-node`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#e7effc" />
        </linearGradient>
        <linearGradient id={`${id}-chip`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#f4f7fd" />
        </linearGradient>
        <radialGradient id={`${id}-halo`}>
          <stop offset="0%" stopColor="#bfdbfe" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#bfdbfe" stopOpacity="0" />
        </radialGradient>
      </defs>

      <motion.g
        animate={reduced ? undefined : { y: [0, -4, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
      >
        {/* ------------------------------------------------------------ */}
        {/* Artifact chips: what each stage produces                      */}
        {/* ------------------------------------------------------------ */}

        {/* Idea list, above the idea node */}
        <g className={chipClass(0)}>
          <motion.path
            className="stroke-zinc-200"
            d="M 72 122 V 98"
            fill="none"
            strokeLinecap="round"
            strokeWidth={1.5}
            variants={{
              hidden: { pathLength: 0, opacity: 0 },
              show: {
                pathLength: 1,
                opacity: 1,
                transition: { duration: 0.35, delay: 0.5 },
              },
            }}
          />
          <motion.g variants={chip(0.55)}>
            <rect
              className="stroke-zinc-200"
              fill={`url(#${id}-chip)`}
              height={50}
              rx={10}
              strokeWidth={1.5}
              width={104}
              x={24}
              y={48}
            />
            <text
              className="fill-zinc-500 text-[10px] font-medium"
              x={36}
              y={66}
            >
              Idea
            </text>
            <rect className="fill-zinc-200" height={5} rx={2.5} width={70} x={36} y={74} />
            <rect className="fill-zinc-100" height={5} rx={2.5} width={48} x={36} y={84} />
          </motion.g>
        </g>

        {/* Script lines, below the script node */}
        <g className={chipClass(1)}>
          <motion.path
            className="stroke-zinc-200"
            d="M 204 178 V 204"
            fill="none"
            strokeLinecap="round"
            strokeWidth={1.5}
            variants={{
              hidden: { pathLength: 0, opacity: 0 },
              show: {
                pathLength: 1,
                opacity: 1,
                transition: { duration: 0.35, delay: 0.75 },
              },
            }}
          />
          <motion.g variants={chip(0.8)}>
            <rect
              className="stroke-zinc-200"
              fill={`url(#${id}-chip)`}
              height={58}
              rx={10}
              strokeWidth={1.5}
              width={100}
              x={154}
              y={204}
            />
            <text
              className="fill-zinc-500 text-[10px] font-medium"
              x={166}
              y={222}
            >
              Script
            </text>
            <rect className="fill-zinc-200" height={5} rx={2.5} width={74} x={166} y={230} />
            <rect className="fill-zinc-200" height={5} rx={2.5} width={58} x={166} y={240} />
            <rect className="fill-zinc-100" height={5} rx={2.5} width={40} x={166} y={250} />
          </motion.g>
        </g>

        {/* Keyframe thumbnails, above the frames node */}
        <g className={chipClass(2)}>
          <motion.path
            className="stroke-zinc-200"
            d="M 348 56 V 50"
            fill="none"
            strokeLinecap="round"
            strokeWidth={1.5}
            variants={{
              hidden: { pathLength: 0, opacity: 0 },
              show: {
                pathLength: 1,
                opacity: 1,
                transition: { duration: 0.3, delay: 1 },
              },
            }}
          />
          <text
            className="fill-zinc-400 text-[10px] font-medium"
            textAnchor="middle"
            x={348}
            y={12}
          >
            Frames
          </text>
          {THUMBS.map((tx, i) => (
            <motion.g key={tx} variants={chip(1.05 + i * 0.08)}>
              <rect
                className="stroke-zinc-200"
                fill={`url(#${id}-chip)`}
                height={28}
                rx={7}
                strokeWidth={1.5}
                width={36}
                x={tx}
                y={20}
              />
              <path
                className="stroke-zinc-300"
                d={`M ${tx + 6} ${41} l 8 -9 5 5 7 -8`}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
              />
              <circle className="fill-zinc-300" cx={tx + 27} cy={27} r={2} />
            </motion.g>
          ))}
        </g>

        {/* Waveform, below the voice node */}
        <g className={chipClass(2)}>
          <motion.path
            className="stroke-zinc-200"
            d="M 348 244 V 256"
            fill="none"
            strokeLinecap="round"
            strokeWidth={1.5}
            variants={{
              hidden: { pathLength: 0, opacity: 0 },
              show: {
                pathLength: 1,
                opacity: 1,
                transition: { duration: 0.3, delay: 1.2 },
              },
            }}
          />
          <motion.g variants={chip(1.25)}>
            <rect
              className="stroke-zinc-200"
              fill={`url(#${id}-chip)`}
              height={36}
              rx={10}
              strokeWidth={1.5}
              width={96}
              x={300}
              y={256}
            />
            <text
              className="fill-zinc-500 text-[10px] font-medium"
              x={312}
              y={278}
            >
              Voice
            </text>
            {WAVE.map((h, i) => (
              <motion.line
                animate={
                  reduced || !active(2)
                    ? undefined
                    : { scaleY: [1, 0.55, 1] }
                }
                className="stroke-zinc-400"
                key={i}
                strokeLinecap="round"
                strokeWidth={2}
                style={{
                  transformBox: "fill-box",
                  transformOrigin: "center",
                }}
                transition={{
                  duration: 1.2,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: i * 0.09,
                }}
                x1={350 + i * 4.5}
                x2={350 + i * 4.5}
                y1={274 - h / 2}
                y2={274 + h / 2}
              />
            ))}
          </motion.g>
        </g>

        {/* Caption bar, above the publish node */}
        <g className={chipClass(3)}>
          <motion.path
            className="stroke-zinc-200"
            d="M 492 122 C 492 104 500 92 512 86"
            fill="none"
            strokeLinecap="round"
            strokeWidth={1.5}
            variants={{
              hidden: { pathLength: 0, opacity: 0 },
              show: {
                pathLength: 1,
                opacity: 1,
                transition: { duration: 0.35, delay: 1.45 },
              },
            }}
          />
          <motion.g variants={chip(1.5)}>
            <rect
              className="stroke-zinc-200"
              fill={`url(#${id}-chip)`}
              height={40}
              rx={10}
              strokeWidth={1.5}
              width={106}
              x={512}
              y={52}
            />
            <rect
              className="fill-zinc-100 stroke-zinc-300"
              height={15}
              rx={4}
              strokeWidth={1}
              width={21}
              x={523}
              y={64}
            />
            <text
              className="fill-zinc-500 text-[8px] font-semibold"
              textAnchor="middle"
              x={533.5}
              y={75}
            >
              CC
            </text>
            <rect className="fill-zinc-200" height={5} rx={2.5} width={54} x={552} y={64} />
            <rect className="fill-zinc-100" height={5} rx={2.5} width={38} x={552} y={74} />
          </motion.g>
        </g>

        {/* ------------------------------------------------------------ */}
        {/* Edges                                                         */}
        {/* ------------------------------------------------------------ */}
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
            strokeLinecap="round"
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

        {/* ------------------------------------------------------------ */}
        {/* Learn trace on its own band below, caption on clear space     */}
        {/* ------------------------------------------------------------ */}
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
                pathLength: { duration: 1.1, ease: "easeInOut", delay: 1 },
                opacity: { duration: 0.2, delay: 1 },
              },
            },
          }}
        />
        <motion.path
          className={cn(
            "transition-[stroke] duration-500",
            driven && stage === 4 ? "stroke-zinc-500" : "stroke-zinc-300",
          )}
          d="M 64 196 L 72 183 L 80 196"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          variants={{
            hidden: { opacity: 0 },
            show: { opacity: 1, transition: { duration: 0.3, delay: 2 } },
          }}
        />
        <motion.text
          className={cn(
            "text-[12px] font-medium transition-[fill] duration-500",
            driven && stage === 4 ? "fill-zinc-700" : "fill-zinc-400",
          )}
          textAnchor="middle"
          variants={{
            hidden: { opacity: 0 },
            show: { opacity: 1, transition: { duration: 0.4, delay: 1.7 } },
          }}
          x={282}
          y={344}
        >
          learnings feed the next video
        </motion.text>

        {/* ------------------------------------------------------------ */}
        {/* Nodes                                                         */}
        {/* ------------------------------------------------------------ */}
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
              {/* Soft halo behind the currently-active stage */}
              {current && (
                <motion.circle
                  animate={
                    reduced ? undefined : { opacity: [0.55, 0.95, 0.55] }
                  }
                  cx={n.x}
                  cy={n.y}
                  fill={`url(#${id}-halo)`}
                  r={48}
                  transition={{
                    duration: 2.4,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
              )}
              <circle
                className={cn(
                  "transition-[fill,stroke] duration-500",
                  on ? "stroke-zinc-800" : "stroke-zinc-300",
                )}
                cx={n.x}
                cy={n.y}
                fill={on ? `url(#${id}-node)` : "#ffffff"}
                r={26}
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
              {/* The recording light on the currently-active stage. */}
              {current && !reduced && (
                <motion.circle
                  animate={{ scale: [1, 1.8], opacity: [0.6, 0] }}
                  className="fill-brand"
                  cx={n.x + 20}
                  cy={n.y - 20}
                  r={4}
                  style={{ transformBox: "fill-box", transformOrigin: "center" }}
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
                  cx={n.x + 20}
                  cy={n.y - 20}
                  r={3.5}
                />
              )}
            </motion.g>
          );
        })}

        {/* Publish label, kept clear of the learn trace */}
        <motion.text
          className={cn(
            "text-[12px] font-medium transition-[fill] duration-500",
            active(3) ? "fill-zinc-600" : "fill-zinc-400",
          )}
          variants={{
            hidden: { opacity: 0 },
            show: { opacity: 1, transition: { duration: 0.4, delay: 0.8 } },
          }}
          x={528}
          y={154}
        >
          Publish
        </motion.text>

        {/* Ambient traveling pulse (self-running mode only). */}
        {!driven && !reduced && (
          <motion.circle
            animate={{
              cx: [72, 204, 348, 492, 282, 72],
              cy: [150, 150, 84, 150, 312, 150],
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
