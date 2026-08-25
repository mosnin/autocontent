"use client";

import { MagneticLink } from "@/components/marketing/magnetic-link";
import { softEase, useReducedMotion } from "@/lib/marketing/motion";
import { motion, useScroll, useTransform, type Variants } from "motion/react";
import Image from "next/image";
import { useRef, type ReactNode } from "react";

const HEADLINE = "Your next campaign is a sentence away";
const WORDS = HEADLINE.split(" ");

const PRINTS = [
  "https://images.unsplash.com/photo-1779881718722-5e7fa09fad7f?q=80&w=770&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  "https://images.unsplash.com/photo-1778051131564-192e359b601d?q=80&w=774&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  "https://images.unsplash.com/photo-1779465190086-021c2012bc4c?q=80&w=770&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  "https://images.unsplash.com/photo-1769968065389-60c3a887d14c?q=80&w=776&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  "https://images.unsplash.com/photo-1773698719619-51e67f93a39f?q=80&w=818&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
];

const PRINT_LAYOUT = [
  { x: -224, y: 30, r: -13 },
  { x: -112, y: 8, r: -6 },
  { x: 0, y: 0, r: 0 },
  { x: 112, y: 8, r: 6 },
  { x: 224, y: 30, r: 13 },
];

const FAN_CONTAINER: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } },
};

const WORD_CONTAINER: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.055, delayChildren: 0.25 } },
};

const WORD_ITEM: Variants = {
  hidden: { y: "110%" },
  visible: { y: 0, transition: { duration: 0.7, ease: softEase } },
};

function PrintFan({ reduce }: { reduce: boolean }): ReactNode {
  return (
    <motion.div
      initial={reduce ? false : "hidden"}
      viewport={{ once: true, margin: "-80px" }}
      variants={FAN_CONTAINER}
      {...(reduce ? {} : { whileInView: "visible" })}
      aria-hidden="true"
      className="relative h-24 w-full origin-top scale-50 sm:h-48 sm:scale-100"
    >
      {PRINTS.map((src, i) => {
        const layout = PRINT_LAYOUT[i] ?? { x: 0, y: 0, r: 0 };
        return (
          <motion.div
            key={src}
            variants={{
              hidden: { opacity: 0, y: 48, x: layout.x * 0.25, rotate: 0 },
              visible: {
                opacity: 1,
                x: layout.x,
                y: layout.y,
                rotate: layout.r,
                transition: { type: "spring", stiffness: 220, damping: 22 },
              },
            }}
            {...(reduce
              ? {
                  style: {
                    transform: `translate(${layout.x}px, ${layout.y}px) rotate(${layout.r}deg)`,
                  },
                }
              : {
                  whileHover: {
                    y: layout.y - 10,
                    rotate: layout.r * 0.4,
                  },
                })}
            className="absolute top-0 left-1/2 -ml-15 w-30 overflow-hidden rounded-2xl border border-white/20 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.55)]"
          >
            <Image
              src={src}
              alt=""
              width={240}
              height={320}
              unoptimized
              className="aspect-[3/4] w-full object-cover"
            />
          </motion.div>
        );
      })}
    </motion.div>
  );
}

export function FinalCta(): ReactNode {
  const reduce = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "center center"],
  });
  const scale = useTransform(scrollYProgress, [0, 1], [0.93, 1]);
  const panelY = useTransform(scrollYProgress, [0, 1], [40, 0]);

  return (
    <section
      ref={sectionRef}
      id="sign-up"
      className="mx-auto max-w-[1440px] scroll-mt-24 px-5 pb-24 sm:px-8 sm:pb-32 lg:px-10"
    >
      <motion.div
        style={{
          backgroundColor: "var(--surface)",
          color: "var(--surface-foreground)",
          ...(reduce ? {} : { scale, y: panelY }),
        }}
        className="flex flex-col items-center overflow-hidden rounded-[40px] px-6 pt-16 pb-24 text-center sm:pt-20 sm:pb-32"
      >
        <PrintFan reduce={reduce} />

        <h2 className="mt-12 max-w-3xl text-[clamp(34px,5.5vw,68px)] leading-[1.06] font-medium tracking-tight">
          {reduce ? (
            HEADLINE
          ) : (
            <>
              <span className="sr-only">{HEADLINE}</span>
              <motion.span
                aria-hidden="true"
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-80px" }}
                variants={WORD_CONTAINER}
                className="flex flex-wrap justify-center gap-x-[0.28em]"
              >
                {WORDS.map((word, i) => (
                  <span
                    key={`${word}-${i}`}
                    className="-mb-[0.12em] inline-flex overflow-hidden pb-[0.12em]"
                  >
                    <motion.span variants={WORD_ITEM} className="inline-block">
                      {word}
                    </motion.span>
                  </span>
                ))}
              </motion.span>
            </>
          )}
        </h2>
        <p className="mt-6 max-w-md text-base leading-relaxed opacity-65">
          Prepaid from five dollars. Describe the channel, review what ships,
          keep every dollar under a cap you set.
        </p>
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <MagneticLink
            href="/sign-up"
            reduce={reduce}
            style={{
              backgroundColor: "var(--surface-foreground)",
              color: "var(--surface)",
            }}
            className="focus-ring inline-flex h-13 items-center rounded-full px-8 text-sm font-medium"
          >
            Start creating
          </MagneticLink>
          <a
            href="/pricing"
            className="focus-ring inline-flex h-13 items-center rounded-full border border-current/25 px-8 text-sm font-medium transition-opacity hover:opacity-70"
          >
            See pricing
          </a>
        </div>
      </motion.div>
    </section>
  );
}
