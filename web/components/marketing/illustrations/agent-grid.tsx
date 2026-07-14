"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { VIEWPORT } from "@/components/marketing/system/motion";

/**
 * A fleet of agent tiles wired into one mesh, lighting up in a diagonal
 * wave as they come online. Each tile carries a face and a task bar;
 * live agents wear the recording light. `tone="dark"` for the ink section.
 */

const COLS = 5;
const ROWS = 3;
const TILE = 72;
const GAP = 16;
const X0 = 20;
const Y0 = 20;

/** Tiles that carry the recording light (agents mid-task). */
const LIVE = new Set(["1-0", "3-1", "0-2", "4-2"]);

export function AgentGridIllustration({
  className,
  tone = "light",
}: {
  className?: string;
  tone?: "light" | "dark";
}) {
  const reduced = useReducedMotion();
  const id = React.useId();
  const dark = tone === "dark";

  const tiles: Array<{ col: number; row: number }> = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      tiles.push({ col, row });
    }
  }

  return (
    <motion.svg
      aria-label="A mesh of agent tiles lighting up in a wave as the fleet comes online"
      className={cn("h-auto w-full", className)}
      initial={reduced ? false : "hidden"}
      role="img"
      viewBox="0 0 464 288"
      viewport={VIEWPORT}
      whileInView="show"
    >
      <defs>
        <linearGradient id={`${id}-tile`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#f3f7fc" />
        </linearGradient>
        <radialGradient cx="50%" cy="40%" id={`${id}-wash`} r="65%">
          {dark ? (
            <>
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.05" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#dbeafe" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#eff6ff" stopOpacity="0" />
            </>
          )}
        </radialGradient>
      </defs>

      {/* Soft wash grounding the fleet */}
      <motion.ellipse
        cx={232}
        cy={144}
        fill={`url(#${id}-wash)`}
        rx={240}
        ry={160}
        variants={{
          hidden: { opacity: 0 },
          show: { opacity: 1, transition: { duration: 1 } },
        }}
      />

      {/* Mesh: hairlines wiring adjacent tiles together */}
      <motion.g
        variants={{
          hidden: { opacity: 0 },
          show: { opacity: 1, transition: { duration: 0.8, delay: 0.5 } },
        }}
      >
        {tiles.map(({ col, row }) => {
          const cx = X0 + col * (TILE + GAP) + TILE / 2;
          const cy = Y0 + row * (TILE + GAP) + TILE / 2;
          const lines: React.ReactNode[] = [];
          if (col < COLS - 1) {
            lines.push(
              <line
                className={dark ? "stroke-white/[0.07]" : "stroke-zinc-200"}
                key={`h-${col}-${row}`}
                strokeWidth={1.5}
                x1={cx + TILE / 2}
                x2={cx + TILE / 2 + GAP}
                y1={cy}
                y2={cy}
              />,
            );
          }
          if (row < ROWS - 1) {
            lines.push(
              <line
                className={dark ? "stroke-white/[0.07]" : "stroke-zinc-200"}
                key={`v-${col}-${row}`}
                strokeWidth={1.5}
                x1={cx}
                x2={cx}
                y1={cy + TILE / 2}
                y2={cy + TILE / 2 + GAP}
              />,
            );
          }
          return lines;
        })}
      </motion.g>

      {tiles.map(({ col, row }) => {
        const x = X0 + col * (TILE + GAP);
        const y = Y0 + row * (TILE + GAP);
        const wave = (col + row) * 0.18;
        const live = LIVE.has(`${col}-${row}`);
        const barW = 24 + ((col * 3 + row * 5) % 3) * 8;
        return (
          <motion.g
            custom={col + row}
            key={`${col}-${row}`}
            variants={{
              hidden: { opacity: 0, scale: 0.8 },
              show: (d: number) => ({
                opacity: 1,
                scale: 1,
                transition: {
                  duration: 0.45,
                  ease: [0.22, 1, 0.36, 1],
                  delay: 0.1 + d * 0.1,
                },
              }),
            }}
          >
            <rect
              className={dark ? "stroke-white/10" : "stroke-zinc-200"}
              fill={dark ? "rgba(255,255,255,0.04)" : `url(#${id}-tile)`}
              height={TILE}
              rx={16}
              strokeWidth={1.5}
              width={TILE}
              x={x}
              y={y}
            />
            {/* The wave: a soft highlight sweeping diagonally. */}
            {!reduced && (
              <motion.rect
                animate={{ opacity: [0, dark ? 0.5 : 1, 0] }}
                className={dark ? "fill-white/10" : "fill-sky-100/80"}
                height={TILE}
                rx={16}
                transition={{
                  duration: 2.2,
                  repeat: Infinity,
                  repeatDelay: 2.2,
                  ease: "easeInOut",
                  delay: 1 + wave,
                }}
                width={TILE}
                x={x}
                y={y}
              />
            )}
            {/* Agent face: two dots. */}
            <circle
              className={dark ? "fill-white/50" : "fill-zinc-400"}
              cx={x + TILE / 2 - 7}
              cy={y + TILE / 2 - 6}
              r={3}
            />
            <circle
              className={dark ? "fill-white/50" : "fill-zinc-400"}
              cx={x + TILE / 2 + 7}
              cy={y + TILE / 2 - 6}
              r={3}
            />
            {/* Task bar: what this agent is chewing on. */}
            <rect
              className={dark ? "fill-white/15" : "fill-zinc-200"}
              height={4}
              rx={2}
              width={barW}
              x={x + (TILE - barW) / 2}
              y={y + TILE - 22}
            />
            {live && (
              <motion.rect
                animate={
                  reduced ? undefined : { width: [10, barW - 6, 10] }
                }
                className={dark ? "fill-white/40" : "fill-zinc-400"}
                height={4}
                rx={2}
                transition={{
                  duration: 4.5,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: wave,
                }}
                width={barW - 6}
                x={x + (TILE - barW) / 2}
                y={y + TILE - 22}
              />
            )}
            {/* Recording light on live agents. */}
            {live && (
              <>
                {!reduced && (
                  <motion.circle
                    animate={{ scale: [1, 1.9], opacity: [0.6, 0] }}
                    className="fill-brand"
                    cx={x + TILE - 15}
                    cy={y + 15}
                    r={3.5}
                    style={{
                      transformBox: "fill-box",
                      transformOrigin: "center",
                    }}
                    transition={{
                      duration: 1.8,
                      repeat: Infinity,
                      ease: "easeOut",
                      delay: wave,
                    }}
                  />
                )}
                <circle
                  className="fill-brand"
                  cx={x + TILE - 15}
                  cy={y + 15}
                  r={3}
                />
              </>
            )}
          </motion.g>
        );
      })}
    </motion.svg>
  );
}
