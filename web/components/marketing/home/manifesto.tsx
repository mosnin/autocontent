"use client";

import { useReducedMotion } from "@/lib/marketing/motion";
import {
  motion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useRef, type ReactNode } from "react";

const STATEMENT =
  "Almost shipping is not shipping. marketer.sh was built for the last mile — the daily post, the ranked article, the spend that never overruns. It produces thousands of takes and reviews every one. You only ever see the keepers.";

const WORDS = STATEMENT.split(" ");

function Word({
  children,
  progress,
  range,
}: {
  children: string;
  progress: MotionValue<number>;
  range: [number, number];
}): ReactNode {
  const opacity = useTransform(progress, range, [0.12, 1]);

  return (
    <motion.span style={{ opacity }} className="inline">
      {children}{" "}
    </motion.span>
  );
}

export function Manifesto(): ReactNode {
  const prefersReducedMotion = useReducedMotion();
  const textRef = useRef<HTMLParagraphElement>(null);

  const { scrollYProgress } = useScroll({
    target: textRef,
    offset: ["start 0.85", "start 0.3"],
  });

  return (
    <section
      aria-label="The marketer.sh standard"
      className="mx-auto max-w-[1440px] px-5 py-28 sm:px-8 sm:py-40 lg:px-10"
    >
      <p
        ref={textRef}
        className="text-foreground max-w-4xl text-[clamp(26px,4.2vw,52px)] leading-[1.18] font-medium tracking-tight"
      >
        {prefersReducedMotion
          ? STATEMENT
          : WORDS.map((word, i) => {
              const start = i / WORDS.length;
              const end = start + 1 / WORDS.length;
              return (
                <Word
                  key={`${word}-${i}`}
                  progress={scrollYProgress}
                  range={[start, end]}
                >
                  {word}
                </Word>
              );
            })}
      </p>
    </section>
  );
}
