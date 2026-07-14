"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { VIEWPORT } from "@/components/marketing/system/motion";

/**
 * The article pipeline: live SERP research → outline tree → body copy
 * typing in → the finished meta description chip. Left to right, drawn in.
 */

const SERP_ROWS = [
  { y: 96, w: 106 },
  { y: 136, w: 88 },
  { y: 176, w: 70 },
];

const OUTLINE_BRANCHES = [
  { d: "M 262 96 H 300", label: "H1", lx: 306, ly: 100 },
  { d: "M 262 136 H 292", label: "H2", lx: 298, ly: 140 },
  { d: "M 262 176 H 292", label: "H2", lx: 298, ly: 180 },
  { d: "M 262 208 H 284", label: "H3", lx: 290, ly: 212 },
];

const TEXT_LINES = [
  { y: 88, w: 106, thick: true },
  { y: 108, w: 112 },
  { y: 124, w: 96 },
  { y: 140, w: 110 },
  { y: 156, w: 84 },
  { y: 172, w: 102 },
];

export function ArticleFlowIllustration({ className }: { className?: string }) {
  const reduced = useReducedMotion();

  return (
    <motion.svg
      aria-label="Article flow diagram: search results feed an outline, the outline becomes body copy, and a meta description is generated"
      className={cn("h-auto w-full", className)}
      initial={reduced ? false : "hidden"}
      role="img"
      viewBox="0 0 560 300"
      viewport={VIEWPORT}
      whileInView="show"
    >
      <motion.g
        animate={reduced ? undefined : { y: [0, -3, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
      >
        {/* SERP card */}
        <motion.rect
          className="fill-white stroke-zinc-200"
          height={172}
          rx={16}
          variants={{
            hidden: { opacity: 0, y: 12 },
            show: {
              opacity: 1,
              y: 0,
              transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
            },
          }}
          width={150}
          x={28}
          y={60}
        />
        <text className="fill-zinc-400 text-[10px] font-medium uppercase tracking-[0.14em]" x={44} y={82}>
          Live SERP
        </text>
        {SERP_ROWS.map((r, i) => (
          <g key={r.y}>
            <motion.circle
              className="fill-zinc-100 stroke-zinc-300"
              cx={52}
              cy={r.y - 4}
              r={7}
              variants={{
                hidden: { opacity: 0, scale: 0.6 },
                show: {
                  opacity: 1,
                  scale: 1,
                  transition: { duration: 0.35, delay: 0.3 + i * 0.12 },
                },
              }}
            />
            <text className="fill-zinc-400 text-[9px] font-medium" textAnchor="middle" x={52} y={r.y - 1}>
              {i + 1}
            </text>
            <motion.rect
              className="fill-zinc-200"
              height={7}
              rx={3.5}
              variants={{
                hidden: { width: 0, opacity: 0 },
                show: {
                  width: r.w,
                  opacity: 1,
                  transition: {
                    duration: 0.5,
                    ease: "easeOut",
                    delay: 0.35 + i * 0.12,
                  },
                },
              }}
              width={r.w}
              x={66}
              y={r.y - 8}
            />
            <motion.rect
              className="fill-zinc-100"
              height={5}
              rx={2.5}
              variants={{
                hidden: { width: 0, opacity: 0 },
                show: {
                  width: r.w * 0.62,
                  opacity: 1,
                  transition: {
                    duration: 0.4,
                    ease: "easeOut",
                    delay: 0.45 + i * 0.12,
                  },
                },
              }}
              width={r.w * 0.62}
              x={66}
              y={r.y + 4}
            />
          </g>
        ))}

        {/* Arrow 1 */}
        <motion.path
          className="stroke-zinc-300"
          d="M 186 146 H 216 m -6 -5 6 5 -6 5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          variants={{
            hidden: { pathLength: 0, opacity: 0 },
            show: {
              pathLength: 1,
              opacity: 1,
              transition: { duration: 0.4, delay: 0.8 },
            },
          }}
        />

        {/* Outline tree */}
        <text className="fill-zinc-400 text-[10px] font-medium uppercase tracking-[0.14em]" x={240} y={62}>
          Outline
        </text>
        <motion.path
          className="stroke-zinc-300"
          d="M 262 76 V 208"
          fill="none"
          strokeLinecap="round"
          strokeWidth={1.5}
          variants={{
            hidden: { pathLength: 0, opacity: 0 },
            show: {
              pathLength: 1,
              opacity: 1,
              transition: { duration: 0.6, ease: "easeInOut", delay: 0.95 },
            },
          }}
        />
        {OUTLINE_BRANCHES.map((b, i) => (
          <g key={b.d}>
            <motion.path
              className="stroke-zinc-300"
              d={b.d}
              fill="none"
              strokeLinecap="round"
              strokeWidth={1.5}
              variants={{
                hidden: { pathLength: 0, opacity: 0 },
                show: {
                  pathLength: 1,
                  opacity: 1,
                  transition: { duration: 0.3, delay: 1.15 + i * 0.1 },
                },
              }}
            />
            <motion.text
              className="fill-zinc-500 text-[10px] font-medium"
              variants={{
                hidden: { opacity: 0 },
                show: {
                  opacity: 1,
                  transition: { duration: 0.3, delay: 1.2 + i * 0.1 },
                },
              }}
              x={b.lx}
              y={b.ly}
            >
              {b.label}
            </motion.text>
          </g>
        ))}

        {/* Arrow 2 */}
        <motion.path
          className="stroke-zinc-300"
          d="M 340 146 H 370 m -6 -5 6 5 -6 5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          variants={{
            hidden: { pathLength: 0, opacity: 0 },
            show: {
              pathLength: 1,
              opacity: 1,
              transition: { duration: 0.4, delay: 1.55 },
            },
          }}
        />

        {/* Article card with lines typing in */}
        <motion.rect
          className="fill-white stroke-zinc-200"
          height={132}
          rx={16}
          variants={{
            hidden: { opacity: 0, y: 12 },
            show: {
              opacity: 1,
              y: 0,
              transition: {
                duration: 0.5,
                ease: [0.22, 1, 0.36, 1],
                delay: 1.6,
              },
            },
          }}
          width={148}
          x={384}
          y={60}
        />
        {TEXT_LINES.map((l, i) => (
          <motion.rect
            className={l.thick ? "fill-zinc-700" : "fill-zinc-200"}
            height={l.thick ? 8 : 5}
            key={l.y}
            rx={l.thick ? 4 : 2.5}
            variants={{
              hidden: { width: 0, opacity: 0 },
              show: {
                width: l.w,
                opacity: 1,
                transition: {
                  duration: 0.45,
                  ease: "easeOut",
                  delay: 1.75 + i * 0.14,
                },
              },
            }}
            width={l.w}
            x={400}
            y={l.y}
          />
        ))}

        {/* Meta tag chip */}
        <motion.g
          variants={{
            hidden: { opacity: 0, scale: 0.92, y: 8 },
            show: {
              opacity: 1,
              scale: 1,
              y: 0,
              transition: {
                duration: 0.5,
                ease: [0.22, 1, 0.36, 1],
                delay: 2.7,
              },
            },
          }}
        >
          <rect
            className="fill-sky-50 stroke-sky-200"
            height={32}
            rx={16}
            width={168}
            x={374}
            y={218}
          />
          <text className="fill-sky-800 font-mono text-[11px]" x={392} y={238}>
            &lt;meta description&gt;
          </text>
          <circle className="fill-emerald-500" cx={528} cy={234} r={6} />
          <path
            className="stroke-white"
            d="m 525.5 234 2 2 3.5 -4"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
          />
        </motion.g>
      </motion.g>
    </motion.svg>
  );
}
