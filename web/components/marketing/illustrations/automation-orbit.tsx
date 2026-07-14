"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { VIEWPORT } from "@/components/marketing/system/motion";

/**
 * The agent core with orbiting surfaces: content channels on the inner
 * ring, the developer surfaces (API / CLI / SDK / MCP) on the outer ring.
 * Slow counter-rotating orbits; everything stays upright.
 */

const CX = 240;
const CY = 170;

const INNER_R = 78;
const OUTER_R = 132;

const INNER_NODES = [
  {
    angle: -90,
    label: "video",
    glyph: <path d="M-3 -4.5 L4.5 0 L-3 4.5 Z" />,
  },
  {
    angle: 30,
    label: "article",
    glyph: <path d="M-4.5 -4 H4.5 M-4.5 0 H4.5 M-4.5 4 H1" fill="none" />,
  },
  {
    angle: 150,
    label: "schedule",
    glyph: (
      <path
        d="M-5 -3.5 H5 V5 H-5 Z M-5 -0.5 H5 M-2.5 -6 V-3.5 M2.5 -6 V-3.5"
        fill="none"
      />
    ),
  },
];

const OUTER_CHIPS = [
  { angle: -45, label: "API" },
  { angle: 45, label: "SDK" },
  { angle: 135, label: "CLI" },
  { angle: -135, label: "MCP" },
];

function polar(r: number, angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
}

export function AutomationOrbitIllustration({
  className,
}: {
  className?: string;
}) {
  const reduced = useReducedMotion();
  const id = React.useId();

  return (
    <motion.svg
      aria-label="Diagram of an agent core orbited by content channels and the API, SDK, CLI, and MCP surfaces"
      className={cn("h-auto w-full", className)}
      initial={reduced ? false : "hidden"}
      role="img"
      viewBox="0 0 480 340"
      viewport={VIEWPORT}
      whileInView="show"
    >
      <defs>
        <radialGradient cx="50%" cy="40%" id={`${id}-glow`} r="60%">
          <stop offset="0%" stopColor="#dbeafe" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#eff6ff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Ambient glow behind the core */}
      <motion.circle
        cx={CX}
        cy={CY}
        fill={`url(#${id}-glow)`}
        r={120}
        variants={{
          hidden: { opacity: 0 },
          show: { opacity: 1, transition: { duration: 1.2 } },
        }}
      />

      {/* Orbit rings draw in */}
      {[INNER_R, OUTER_R].map((r, i) => (
        <motion.circle
          className="stroke-zinc-200"
          cx={CX}
          cy={CY}
          fill="none"
          key={r}
          r={r}
          strokeDasharray="3 7"
          strokeLinecap="round"
          strokeWidth={1.25}
          variants={{
            hidden: { pathLength: 0, opacity: 0 },
            show: {
              pathLength: 1,
              opacity: 1,
              transition: {
                pathLength: {
                  duration: 1.4,
                  ease: "easeInOut",
                  delay: 0.2 + i * 0.25,
                },
                opacity: { duration: 0.3, delay: 0.2 + i * 0.25 },
              },
            },
          }}
        />
      ))}

      {/* Inner orbit: channels */}
      <motion.g
        animate={reduced ? undefined : { rotate: 360 }}
        transition={{ duration: 48, repeat: Infinity, ease: "linear" }}
      >
        {INNER_NODES.map((n, i) => {
          const p = polar(INNER_R, n.angle);
          return (
            <motion.g
              animate={reduced ? undefined : { rotate: -360 }}
              key={n.label}
              transition={{ duration: 48, repeat: Infinity, ease: "linear" }}
            >
              <motion.g
                variants={{
                  hidden: { opacity: 0, scale: 0.6 },
                  show: {
                    opacity: 1,
                    scale: 1,
                    transition: {
                      duration: 0.45,
                      ease: [0.22, 1, 0.36, 1],
                      delay: 0.9 + i * 0.15,
                    },
                  },
                }}
              >
                <circle
                  className="fill-white stroke-zinc-300"
                  cx={p.x}
                  cy={p.y}
                  r={17}
                  strokeWidth={1.5}
                />
                <g
                  className="fill-zinc-500 stroke-zinc-500"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.4}
                  transform={`translate(${p.x} ${p.y})`}
                >
                  {n.glyph}
                </g>
              </motion.g>
            </motion.g>
          );
        })}
      </motion.g>

      {/* Outer orbit: developer surfaces */}
      <motion.g
        animate={reduced ? undefined : { rotate: -360 }}
        transition={{ duration: 72, repeat: Infinity, ease: "linear" }}
      >
        {OUTER_CHIPS.map((c, i) => {
          const p = polar(OUTER_R, c.angle);
          return (
            <motion.g
              animate={reduced ? undefined : { rotate: 360 }}
              key={c.label}
              transition={{ duration: 72, repeat: Infinity, ease: "linear" }}
            >
              <motion.g
                variants={{
                  hidden: { opacity: 0, scale: 0.6 },
                  show: {
                    opacity: 1,
                    scale: 1,
                    transition: {
                      duration: 0.45,
                      ease: [0.22, 1, 0.36, 1],
                      delay: 1.2 + i * 0.12,
                    },
                  },
                }}
              >
                <rect
                  className="fill-white stroke-zinc-300"
                  height={24}
                  rx={12}
                  strokeWidth={1.5}
                  width={48}
                  x={p.x - 24}
                  y={p.y - 12}
                />
                <text
                  className="fill-zinc-600 font-mono text-[11px] font-medium"
                  textAnchor="middle"
                  x={p.x}
                  y={p.y + 4}
                >
                  {c.label}
                </text>
              </motion.g>
            </motion.g>
          );
        })}
      </motion.g>

      {/* Agent core */}
      <motion.g
        variants={{
          hidden: { opacity: 0, scale: 0.7 },
          show: {
            opacity: 1,
            scale: 1,
            transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.5 },
          },
        }}
      >
        <rect
          className="fill-white stroke-zinc-800"
          height={58}
          rx={17}
          strokeWidth={1.5}
          width={58}
          x={CX - 29}
          y={CY - 29}
        />
        {[-9, 9].map((dx) =>
          [-9, 9].map((dy) => (
            <circle
              className="fill-zinc-800"
              cx={CX + dx}
              cy={CY + dy}
              key={`${dx}-${dy}`}
              r={3}
            />
          )),
        )}
        {/* The recording light: the agent is live. */}
        {!reduced && (
          <motion.circle
            animate={{ scale: [1, 1.9], opacity: [0.6, 0] }}
            className="fill-brand"
            cx={CX + 24}
            cy={CY - 24}
            r={4}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
          />
        )}
        <circle className="fill-brand" cx={CX + 24} cy={CY - 24} r={3.5} />
      </motion.g>
    </motion.svg>
  );
}
