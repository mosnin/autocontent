"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { VIEWPORT } from "@/components/marketing/system/motion";

/**
 * The article pipeline, left to right: live SERP research (ranked result
 * rows) → outline tree (H1/H2/H3 nodes) → the article page drawing itself
 * in, with title/slug/meta chips validating below. Idle float, brand pulse
 * on the live dot only; static under reduced motion.
 */

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const SERP_ROWS = [
  { y: 96, w: 112 },
  { y: 138, w: 96 },
  { y: 180, w: 104 },
  { y: 222, w: 82 },
];

const OUTLINE_BRANCHES = [
  { y: 100, x: 292, label: "H1", barX: 324, barW: 52 },
  { y: 140, x: 300, label: "H2", barX: 332, barW: 44 },
  { y: 180, x: 300, label: "H2", barX: 332, barW: 48 },
  { y: 220, x: 308, label: "H3", barX: 340, barW: 32 },
];

const TEXT_LINES = [
  { y: 144, w: 140 },
  { y: 158, w: 128 },
  { y: 172, w: 136 },
  { y: 186, w: 116 },
  { y: 200, w: 132 },
  { y: 214, w: 96 },
];

const META_CHIPS = [
  { x: 348, w: 90, label: "title 58/60" },
  { x: 446, w: 72, label: "slug ok" },
  { x: 526, w: 90, label: "meta 152ch" },
];

export function ArticleFlowIllustration({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  const id = React.useId();

  return (
    <motion.svg
      aria-label="Article flow diagram: ranked search results feed an outline tree, the outline becomes a drafted article page, and title, slug, and meta checks pass below"
      className={cn("h-auto w-full", className)}
      initial={reduced ? false : "hidden"}
      role="img"
      viewBox="0 0 640 340"
      viewport={VIEWPORT}
      whileInView="show"
    >
      <defs>
        <linearGradient id={`${id}-card`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#f5f8fd" />
        </linearGradient>
      </defs>

      <motion.g
        animate={reduced ? undefined : { y: [0, -3, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
      >
        {/* ------------------------------------------------------------ */}
        {/* SERP card                                                     */}
        {/* ------------------------------------------------------------ */}
        <motion.rect
          className="stroke-zinc-200"
          fill={`url(#${id}-card)`}
          height={232}
          rx={18}
          strokeWidth={1.5}
          variants={{
            hidden: { opacity: 0, y: 12 },
            show: {
              opacity: 1,
              y: 0,
              transition: { duration: 0.5, ease: EASE },
            },
          }}
          width={180}
          x={24}
          y={40}
        />
        {/* The live dot: the single brand accent. */}
        {!reduced && (
          <motion.circle
            animate={{ scale: [1, 2], opacity: [0.5, 0] }}
            className="fill-brand"
            cx={44}
            cy={64}
            r={4}
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
          />
        )}
        <circle className="fill-brand" cx={44} cy={64} r={3} />
        <text
          className="fill-zinc-400 text-[10px] font-medium uppercase tracking-[0.14em]"
          x={54}
          y={68}
        >
          Live SERP
        </text>
        {SERP_ROWS.map((r, i) => (
          <g key={r.y}>
            <motion.g
              variants={{
                hidden: { opacity: 0, scale: 0.7 },
                show: {
                  opacity: 1,
                  scale: 1,
                  transition: { duration: 0.35, delay: 0.25 + i * 0.1 },
                },
              }}
            >
              <rect
                className="fill-white stroke-zinc-200"
                height={20}
                rx={7}
                strokeWidth={1.5}
                width={22}
                x={40}
                y={r.y - 12}
              />
              <text
                className="fill-zinc-500 text-[10px] font-semibold"
                textAnchor="middle"
                x={51}
                y={r.y + 2}
              >
                {i + 1}
              </text>
            </motion.g>
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
                    duration: 0.45,
                    ease: "easeOut",
                    delay: 0.3 + i * 0.1,
                  },
                },
              }}
              width={r.w}
              x={72}
              y={r.y - 10}
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
                    delay: 0.38 + i * 0.1,
                  },
                },
              }}
              width={r.w * 0.62}
              x={72}
              y={r.y + 2}
            />
          </g>
        ))}

        {/* Arrow 1 */}
        <motion.path
          className="stroke-zinc-300"
          d="M 212 156 H 240 m -6 -5 6 5 -6 5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          variants={{
            hidden: { pathLength: 0, opacity: 0 },
            show: {
              pathLength: 1,
              opacity: 1,
              transition: { duration: 0.4, delay: 0.75 },
            },
          }}
        />

        {/* ------------------------------------------------------------ */}
        {/* Outline card                                                  */}
        {/* ------------------------------------------------------------ */}
        <motion.rect
          className="stroke-zinc-200"
          fill={`url(#${id}-card)`}
          height={232}
          rx={18}
          strokeWidth={1.5}
          variants={{
            hidden: { opacity: 0, y: 12 },
            show: {
              opacity: 1,
              y: 0,
              transition: { duration: 0.5, ease: EASE, delay: 0.85 },
            },
          }}
          width={152}
          x={248}
          y={40}
        />
        <motion.text
          className="fill-zinc-400 text-[10px] font-medium uppercase tracking-[0.14em]"
          variants={{
            hidden: { opacity: 0 },
            show: { opacity: 1, transition: { duration: 0.3, delay: 0.95 } },
          }}
          x={268}
          y={68}
        >
          Outline
        </motion.text>
        <motion.path
          className="stroke-zinc-300"
          d="M 276 92 V 244"
          fill="none"
          strokeLinecap="round"
          strokeWidth={1.5}
          variants={{
            hidden: { pathLength: 0, opacity: 0 },
            show: {
              pathLength: 1,
              opacity: 1,
              transition: { duration: 0.6, ease: "easeInOut", delay: 1 },
            },
          }}
        />
        {OUTLINE_BRANCHES.map((b, i) => (
          <g key={b.y}>
            <motion.path
              className="stroke-zinc-300"
              d={`M 276 ${b.y} H ${b.x}`}
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
            <motion.g
              variants={{
                hidden: { opacity: 0, scale: 0.8 },
                show: {
                  opacity: 1,
                  scale: 1,
                  transition: { duration: 0.35, delay: 1.2 + i * 0.1 },
                },
              }}
            >
              <rect
                className="fill-white stroke-zinc-300"
                height={18}
                rx={6}
                strokeWidth={1.5}
                width={26}
                x={b.x}
                y={b.y - 9}
              />
              <text
                className="fill-zinc-600 text-[9px] font-semibold"
                textAnchor="middle"
                x={b.x + 13}
                y={b.y + 3.5}
              >
                {b.label}
              </text>
              <rect
                className="fill-zinc-200"
                height={6}
                rx={3}
                width={b.barW}
                x={b.barX}
                y={b.y - 3}
              />
            </motion.g>
          </g>
        ))}

        {/* Arrow 2 */}
        <motion.path
          className="stroke-zinc-300"
          d="M 408 156 H 436 m -6 -5 6 5 -6 5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          variants={{
            hidden: { pathLength: 0, opacity: 0 },
            show: {
              pathLength: 1,
              opacity: 1,
              transition: { duration: 0.4, delay: 1.6 },
            },
          }}
        />

        {/* ------------------------------------------------------------ */}
        {/* Article page card                                             */}
        {/* ------------------------------------------------------------ */}
        <motion.rect
          className="stroke-zinc-200"
          fill={`url(#${id}-card)`}
          height={232}
          rx={18}
          strokeWidth={1.5}
          variants={{
            hidden: { opacity: 0, y: 12 },
            show: {
              opacity: 1,
              y: 0,
              transition: { duration: 0.5, ease: EASE, delay: 1.7 },
            },
          }}
          width={172}
          x={444}
          y={40}
        />
        {/* Title */}
        <motion.rect
          className="fill-zinc-700"
          height={9}
          rx={4.5}
          variants={{
            hidden: { width: 0, opacity: 0 },
            show: {
              width: 122,
              opacity: 1,
              transition: { duration: 0.5, ease: "easeOut", delay: 1.85 },
            },
          }}
          width={122}
          x={460}
          y={62}
        />
        {/* Hero block */}
        <motion.g
          variants={{
            hidden: { opacity: 0, scale: 0.96 },
            show: {
              opacity: 1,
              scale: 1,
              transition: { duration: 0.45, ease: EASE, delay: 2 },
            },
          }}
        >
          <rect
            className="fill-sky-50 stroke-sky-100"
            height={44}
            rx={8}
            strokeWidth={1.5}
            width={140}
            x={460}
            y={84}
          />
          <path
            className="stroke-sky-200"
            d="M 486 118 l 14 -15 9 9 12 -13"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
          />
          <circle className="fill-sky-200" cx={545} cy={96} r={3.5} />
        </motion.g>
        {/* Body copy draws in */}
        {TEXT_LINES.map((l, i) => (
          <motion.rect
            className="fill-zinc-200"
            height={5}
            key={l.y}
            rx={2.5}
            variants={{
              hidden: { width: 0, opacity: 0 },
              show: {
                width: l.w,
                opacity: 1,
                transition: {
                  duration: 0.4,
                  ease: "easeOut",
                  delay: 2.1 + i * 0.12,
                },
              },
            }}
            width={l.w}
            x={460}
            y={l.y}
          />
        ))}
        {/* Published check */}
        <motion.g
          variants={{
            hidden: { opacity: 0, scale: 0.6 },
            show: {
              opacity: 1,
              scale: 1,
              transition: { duration: 0.4, ease: EASE, delay: 2.9 },
            },
          }}
        >
          <circle className="fill-emerald-500" cx={588} cy={246} r={8} />
          <path
            className="stroke-white"
            d="m 584.5 246 2.5 2.5 5 -5.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
          />
        </motion.g>

        {/* ------------------------------------------------------------ */}
        {/* Meta chips below the page                                     */}
        {/* ------------------------------------------------------------ */}
        <motion.path
          className="stroke-zinc-200"
          d="M 530 272 V 288"
          fill="none"
          strokeLinecap="round"
          strokeWidth={1.5}
          variants={{
            hidden: { pathLength: 0, opacity: 0 },
            show: {
              pathLength: 1,
              opacity: 1,
              transition: { duration: 0.3, delay: 3 },
            },
          }}
        />
        {META_CHIPS.map((c, i) => (
          <motion.g
            key={c.label}
            variants={{
              hidden: { opacity: 0, y: 8, scale: 0.94 },
              show: {
                opacity: 1,
                y: 0,
                scale: 1,
                transition: { duration: 0.45, ease: EASE, delay: 3.05 + i * 0.14 },
              },
            }}
          >
            <rect
              className="fill-white stroke-zinc-200"
              height={26}
              rx={13}
              strokeWidth={1.5}
              width={c.w}
              x={c.x}
              y={288}
            />
            <circle className="fill-emerald-500" cx={c.x + 14} cy={301} r={3} />
            <text
              className="fill-zinc-500 font-mono text-[10px]"
              x={c.x + 23}
              y={304.5}
            >
              {c.label}
            </text>
          </motion.g>
        ))}
      </motion.g>
    </motion.svg>
  );
}
