"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { VIEWPORT } from "@/components/marketing/system/motion";

/**
 * The spend guard: a gauge fills toward a hard cap line that glows, then a
 * shield-check confirms nothing can pass it. Today's spend never exceeds
 * the cap; that's the whole story of the drawing.
 */

/** Semicircle gauge, left ($0) to right ($10). */
const ARC_D = "M 90 190 A 120 120 0 0 1 330 190";

/** Spend fill stops at 72% of the arc; the cap tick sits at 78%. */
const FILL_RATIO = 0.72;

export function SpendGuardIllustration({ className }: { className?: string }) {
  const reduced = useReducedMotion();

  return (
    <motion.svg
      aria-label="Gauge showing today's spend filling toward a hard cap, with a shield check confirming the cap holds"
      className={cn("h-auto w-full", className)}
      initial={reduced ? false : "hidden"}
      role="img"
      viewBox="0 0 420 300"
      viewport={VIEWPORT}
      whileInView="show"
    >
      <motion.g
        animate={reduced ? undefined : { y: [0, -3, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
      >
        {/* Track */}
        <motion.path
          className="stroke-zinc-200"
          d={ARC_D}
          fill="none"
          strokeLinecap="round"
          strokeWidth={10}
          variants={{
            hidden: { pathLength: 0, opacity: 0 },
            show: {
              pathLength: 1,
              opacity: 1,
              transition: {
                pathLength: { duration: 0.9, ease: "easeInOut" },
                opacity: { duration: 0.2 },
              },
            },
          }}
        />

        {/* Spend fill: rises toward the cap, never past it */}
        <motion.path
          className="stroke-zinc-800"
          d={ARC_D}
          fill="none"
          strokeLinecap="round"
          strokeWidth={10}
          variants={{
            hidden: { pathLength: 0, opacity: 0 },
            show: {
              pathLength: FILL_RATIO,
              opacity: 1,
              transition: {
                pathLength: { duration: 1.6, ease: [0.22, 1, 0.36, 1], delay: 0.7 },
                opacity: { duration: 0.2, delay: 0.7 },
              },
            },
          }}
        />

        {/* The cap line, in the brand accent, glowing softly */}
        <motion.line
          className="stroke-brand"
          strokeLinecap="round"
          strokeWidth={3}
          variants={{
            hidden: { opacity: 0 },
            show: { opacity: 1, transition: { duration: 0.3, delay: 1.2 } },
          }}
          x1={290.2}
          x2={313.3}
          y1={123.7}
          y2={104.6}
        />
        {!reduced && (
          <motion.line
            animate={{ opacity: [0, 0.5, 0] }}
            className="stroke-brand"
            strokeLinecap="round"
            strokeWidth={9}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut",
              delay: 2.2,
            }}
            x1={290.2}
            x2={313.3}
            y1={123.7}
            y2={104.6}
          />
        )}
        <motion.text
          className="fill-zinc-500 text-[11px] font-medium"
          variants={{
            hidden: { opacity: 0 },
            show: { opacity: 1, transition: { duration: 0.3, delay: 1.35 } },
          }}
          x={322}
          y={92}
        >
          hard cap
        </motion.text>

        {/* Scale labels */}
        <text className="fill-zinc-400 font-mono text-[11px]" textAnchor="middle" x={90} y={216}>
          $0
        </text>
        <text className="fill-zinc-400 font-mono text-[11px]" textAnchor="middle" x={330} y={216}>
          $10
        </text>

        {/* Shield check: the cap holds */}
        <motion.g
          variants={{
            hidden: { opacity: 0, scale: 0.7 },
            show: {
              opacity: 1,
              scale: 1,
              transition: {
                duration: 0.55,
                ease: [0.22, 1, 0.36, 1],
                delay: 2.4,
              },
            },
          }}
        >
          <path
            className="fill-white stroke-zinc-800"
            d="M 210 100 L 226 107 V 121 C 226 131 219 138 210 142 C 201 138 194 131 194 121 V 107 Z"
            strokeLinejoin="round"
            strokeWidth={1.5}
          />
          <motion.path
            className="stroke-emerald-600"
            d="m 203 121 5 5 9 -11"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            variants={{
              hidden: { pathLength: 0 },
              show: {
                pathLength: 1,
                transition: { duration: 0.4, ease: "easeOut", delay: 2.8 },
              },
            }}
          />
        </motion.g>

        {/* Readout */}
        <motion.g
          variants={{
            hidden: { opacity: 0, y: 8 },
            show: {
              opacity: 1,
              y: 0,
              transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 1.9 },
            },
          }}
        >
          <text
            className="fill-zinc-900 font-mono text-[26px] font-semibold"
            textAnchor="middle"
            x={210}
            y={186}
          >
            $7.20
          </text>
          <text
            className="fill-zinc-400 text-[12px]"
            textAnchor="middle"
            x={210}
            y={206}
          >
            spent today, cap $10.00
          </text>
        </motion.g>

        {/* Fine print of the drawing: refusal behavior */}
        <motion.g
          variants={{
            hidden: { opacity: 0, y: 6 },
            show: {
              opacity: 1,
              y: 0,
              transition: { duration: 0.5, delay: 3 },
            },
          }}
        >
          <rect
            className="fill-white stroke-zinc-200"
            height={30}
            rx={15}
            width={228}
            x={96}
            y={244}
          />
          <circle className="fill-emerald-500" cx={116} cy={259} r={5.5} />
          <path
            className="stroke-white"
            d="m 113.5 259 1.8 1.8 3.2 -3.6"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.4}
          />
          <text className="fill-zinc-600 text-[11.5px] font-medium" x={130} y={263}>
            Calls past the cap are refused
          </text>
        </motion.g>
      </motion.g>
    </motion.svg>
  );
}
