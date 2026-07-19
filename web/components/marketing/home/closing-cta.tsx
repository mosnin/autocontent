"use client";

import * as React from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";

import { EASE, VIEWPORT } from "@/components/marketing/system/motion";

/** The gradient send-off panel — reference's full-bleed closer, in the
 *  brand's warm amber→rose instead of purple. */
export function ClosingCta() {
  const reduced = useReducedMotion();
  return (
    <section aria-label="Get started" className="bg-white px-3 pb-20 md:px-6 md:pb-28">
      <motion.div
        className="relative mx-auto max-w-[88rem] overflow-hidden rounded-[2.5rem] bg-[linear-gradient(135deg,#f59e0b_0%,#f43f5e_60%,#e11d48_100%)] px-6 py-24 text-center md:py-32"
        initial={reduced ? { opacity: 1 } : { opacity: 0, y: 32 }}
        transition={{ duration: 0.8, ease: EASE }}
        viewport={VIEWPORT}
        whileInView={{ opacity: 1, y: 0 }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_0%,rgba(255,255,255,0.25),transparent_70%)]"
        />
        <span
          aria-hidden
          className="relative mx-auto flex size-14 items-center justify-center rounded-2xl bg-white/15 backdrop-blur"
        >
          <svg
            className="size-7 text-white"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2.25"
            viewBox="0 0 24 24"
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
        </span>
        <h2 className="relative mt-8 font-display text-4xl font-semibold tracking-tight text-white md:text-6xl">
          Time is priceless.
          <br />
          Your marketing runs itself.
        </h2>
        <p className="relative mx-auto mt-5 max-w-xl text-lg leading-relaxed text-white/85">
          Five dollars of credit. A cap you set. A gate you hold. Your first
          short ships today.
        </p>
        <div className="relative mt-9">
          <Link
            className="inline-flex min-h-12 items-center rounded-xl bg-white px-8 text-[15px] font-semibold text-zinc-950 shadow-[0_8px_32px_rgba(0,0,0,0.18)] transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            href="/sign-up"
          >
            Get started. It&apos;s $5.
          </Link>
        </div>
      </motion.div>
    </section>
  );
}
