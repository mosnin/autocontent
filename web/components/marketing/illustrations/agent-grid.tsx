"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { VIEWPORT } from "@/components/marketing/system/motion";

/**
 * A grid of agent tiles lighting up in a diagonal wave, like a fleet
 * coming online. `tone="dark"` for the ink section.
 */

const COLS = 5;
const ROWS = 3;
const TILE = 64;
const GAP = 24;
const X0 = 24;
const Y0 = 24;

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
  const dark = tone === "dark";

  const tiles: Array<{ col: number; row: number }> = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      tiles.push({ col, row });
    }
  }

  return (
    <motion.svg
      aria-label="A grid of agent tiles lighting up in a wave"
      className={cn("h-auto w-full", className)}
      initial={reduced ? false : "hidden"}
      role="img"
      viewBox="0 0 464 288"
      viewport={VIEWPORT}
      whileInView="show"
    >
      {tiles.map(({ col, row }) => {
        const x = X0 + col * (TILE + GAP);
        const y = Y0 + row * (TILE + GAP);
        const wave = (col + row) * 0.18;
        const live = LIVE.has(`${col}-${row}`);
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
              className={
                dark
                  ? "fill-white/[0.04] stroke-white/10"
                  : "fill-white stroke-zinc-200"
              }
              height={TILE}
              rx={16}
              strokeWidth={1.25}
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
              cy={y + TILE / 2}
              r={3}
            />
            <circle
              className={dark ? "fill-white/50" : "fill-zinc-400"}
              cx={x + TILE / 2 + 7}
              cy={y + TILE / 2}
              r={3}
            />
            {/* Recording light on live agents. */}
            {live && (
              <>
                {!reduced && (
                  <motion.circle
                    animate={{ scale: [1, 1.9], opacity: [0.6, 0] }}
                    className="fill-brand"
                    cx={x + TILE - 14}
                    cy={y + 14}
                    r={3.5}
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
                  cx={x + TILE - 14}
                  cy={y + 14}
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
