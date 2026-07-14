"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { VIEWPORT } from "@/components/marketing/system/motion";

/**
 * The performance loop: a retention line draws itself across a chart,
 * insights condense out of it, and the trace arcs back to the next brief.
 * Post → measure → learn → next brief.
 */

const LINE_D =
  "M 200 204 C 236 192 254 196 286 172 C 318 148 342 140 378 126 C 414 112 454 92 500 72";

const LOOP_D = "M 500 72 C 566 128 470 288 150 282 C 122 281 104 274 94 264";

const POINTS = [
  { x: 200, y: 204 },
  { x: 286, y: 172 },
  { x: 378, y: 126 },
  { x: 500, y: 72 },
];

const INSIGHTS = [
  { x: 24, y: 62, w: 126, dot: "fill-sky-400", label: "hooks under 2s win" },
  { x: 34, y: 102, w: 116, dot: "fill-indigo-300", label: "voice B converts" },
];

export function AnalyticsLoopIllustration({
  className,
}: {
  className?: string;
}) {
  const reduced = useReducedMotion();
  const id = React.useId();

  return (
    <motion.svg
      aria-label="Diagram of a performance chart whose results become insights that loop back into the next content brief"
      className={cn("h-auto w-full", className)}
      initial={reduced ? false : "hidden"}
      role="img"
      viewBox="0 0 560 320"
      viewport={VIEWPORT}
      whileInView="show"
    >
      <defs>
        <linearGradient id={`${id}-area`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#bfdbfe" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#eff6ff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-card`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#f6f9fd" />
        </linearGradient>
      </defs>

      <motion.g
        animate={reduced ? undefined : { y: [0, -3, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      >
        {/* Chart card */}
        <motion.rect
          className="stroke-zinc-200"
          fill={`url(#${id}-card)`}
          height={212}
          rx={20}
          strokeWidth={1.5}
          variants={{
            hidden: { opacity: 0, y: 14 },
            show: {
              opacity: 1,
              y: 0,
              transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
            },
          }}
          width={364}
          x={170}
          y={32}
        />
        <text
          className="fill-zinc-400 text-[10px] font-medium uppercase tracking-[0.14em]"
          x={200}
          y={62}
        >
          Retention by post
        </text>
        {/* KPI chip */}
        <motion.g
          variants={{
            hidden: { opacity: 0, scale: 0.85 },
            show: {
              opacity: 1,
              scale: 1,
              transition: { duration: 0.4, delay: 1.9 },
            },
          }}
        >
          <rect
            className="fill-emerald-50 stroke-emerald-600/20"
            height={22}
            rx={11}
            strokeWidth={1.5}
            width={82}
            x={422}
            y={46}
          />
          <path
            className="stroke-emerald-600"
            d="M 436 62 l 5 -6 4 3 6 -7"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
          />
          <text
            className="fill-emerald-700 font-mono text-[10px] font-medium"
            x={456}
            y={61}
          >
            avg 64%
          </text>
        </motion.g>

        {/* Grid + axis labels */}
        {[
          { y: 112, label: "70" },
          { y: 156, label: "50" },
          { y: 200, label: "30" },
        ].map((g, i) => (
          <motion.g
            key={g.y}
            variants={{
              hidden: { opacity: 0 },
              show: {
                opacity: 1,
                transition: { duration: 0.4, delay: 0.4 + i * 0.08 },
              },
            }}
          >
            <line
              className="stroke-zinc-100"
              strokeWidth={1}
              x1={210}
              x2={504}
              y1={g.y}
              y2={g.y}
            />
            <text
              className="fill-zinc-300 font-mono text-[9px]"
              textAnchor="end"
              x={204}
              y={g.y + 3}
            >
              {g.label}
            </text>
          </motion.g>
        ))}
        {/* Baseline post ticks */}
        {POINTS.map((p, i) => (
          <motion.line
            className="stroke-zinc-200"
            key={`tick-${p.x}`}
            strokeLinecap="round"
            strokeWidth={1.5}
            variants={{
              hidden: { opacity: 0 },
              show: {
                opacity: 1,
                transition: { duration: 0.3, delay: 0.6 + i * 0.08 },
              },
            }}
            x1={p.x}
            x2={p.x}
            y1={214}
            y2={220}
          />
        ))}

        {/* Area fill fades in after the line draws */}
        <motion.path
          d={`${LINE_D} L 500 204 L 200 204 Z`}
          fill={`url(#${id}-area)`}
          variants={{
            hidden: { opacity: 0 },
            show: { opacity: 1, transition: { duration: 0.8, delay: 1.6 } },
          }}
        />

        {/* The line draws itself */}
        <motion.path
          className="stroke-zinc-800"
          d={LINE_D}
          fill="none"
          strokeLinecap="round"
          strokeWidth={2}
          variants={{
            hidden: { pathLength: 0, opacity: 0 },
            show: {
              pathLength: 1,
              opacity: 1,
              transition: {
                pathLength: { duration: 1.5, ease: "easeInOut", delay: 0.5 },
                opacity: { duration: 0.2, delay: 0.5 },
              },
            },
          }}
        />

        {/* Marker dots at each post */}
        {POINTS.map((p, i) => (
          <motion.g
            key={p.x}
            variants={{
              hidden: { opacity: 0, scale: 0.5 },
              show: {
                opacity: 1,
                scale: 1,
                transition: { duration: 0.35, delay: 1.1 + i * 0.2 },
              },
            }}
          >
            <circle
              className="fill-white stroke-zinc-800"
              cx={p.x}
              cy={p.y}
              r={i >= 2 ? 5 : 3.5}
              strokeWidth={i >= 2 ? 2 : 1.5}
            />
          </motion.g>
        ))}

        {/* Insight chips: what the loop carries back */}
        {INSIGHTS.map((c, i) => (
          <motion.g
            key={c.label}
            variants={{
              hidden: { opacity: 0, y: 8, scale: 0.94 },
              show: {
                opacity: 1,
                y: 0,
                scale: 1,
                transition: {
                  duration: 0.45,
                  ease: [0.22, 1, 0.36, 1],
                  delay: 2.3 + i * 0.15,
                },
              },
            }}
          >
            <rect
              className="fill-white stroke-zinc-200"
              height={30}
              rx={15}
              strokeWidth={1.5}
              width={c.w}
              x={c.x}
              y={c.y}
            />
            <circle className={c.dot} cx={c.x + 16} cy={c.y + 15} r={3} />
            <text
              className="fill-zinc-500 text-[10px] font-medium"
              x={c.x + 25}
              y={c.y + 18.5}
            >
              {c.label}
            </text>
          </motion.g>
        ))}
        {/* Insights feed the next brief */}
        <motion.path
          className="stroke-zinc-200"
          d="M 84 136 C 76 168 68 192 64 208"
          fill="none"
          strokeDasharray="2 6"
          strokeLinecap="round"
          strokeWidth={1.5}
          variants={{
            hidden: { pathLength: 0, opacity: 0 },
            show: {
              pathLength: 1,
              opacity: 1,
              transition: { duration: 0.6, ease: "easeInOut", delay: 2.7 },
            },
          }}
        />

        {/* Loop trace back to the idea node */}
        <motion.path
          className="stroke-zinc-400"
          d={LOOP_D}
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
                pathLength: { duration: 1.2, ease: "easeInOut", delay: 2.1 },
                opacity: { duration: 0.2, delay: 2.1 },
              },
            },
          }}
        />
        {/* Arrowhead */}
        <motion.path
          className="stroke-zinc-400"
          d="M 104 253 L 94 264 L 108 268"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          variants={{
            hidden: { opacity: 0 },
            show: { opacity: 1, transition: { duration: 0.3, delay: 3.2 } },
          }}
        />

        {/* Idea node */}
        <motion.g
          variants={{
            hidden: { opacity: 0, scale: 0.7 },
            show: {
              opacity: 1,
              scale: 1,
              transition: {
                duration: 0.5,
                ease: [0.22, 1, 0.36, 1],
                delay: 3.1,
              },
            },
          }}
        >
          <circle
            className="fill-sky-50 stroke-zinc-800"
            cx={64}
            cy={236}
            r={24}
            strokeWidth={1.5}
          />
          <g
            className="stroke-zinc-800"
            fill="none"
            strokeLinecap="round"
            strokeWidth={1.5}
            transform="translate(64 236)"
          >
            <path d="M0 -8 V-4 M0 4 V8 M-8 0 H-4 M4 0 H8 M-5.5 -5.5 L-2.5 -2.5 M2.5 2.5 L5.5 5.5 M-5.5 5.5 L-2.5 2.5 M2.5 -2.5 L5.5 -5.5" />
          </g>
          <text
            className="fill-zinc-600 text-[11px] font-medium"
            textAnchor="middle"
            x={64}
            y={280}
          >
            next brief
          </text>
        </motion.g>

        {/* Traveling pulse along the loop */}
        {!reduced && (
          <motion.circle
            animate={{
              cx: [500, 545, 470, 320, 160, 96],
              cy: [72, 140, 246, 285, 281, 262],
              opacity: [0, 1, 1, 1, 1, 0],
            }}
            className="fill-brand"
            r={3.5}
            transition={{
              duration: 3,
              repeat: Infinity,
              repeatDelay: 1.4,
              ease: "linear",
              delay: 3.4,
            }}
          />
        )}
      </motion.g>
    </motion.svg>
  );
}
