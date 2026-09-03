"use client";

import { SectionHeading } from "@/components/marketing/section-heading";
import { useReducedMotion } from "@/lib/marketing/motion";
import { motion, useScroll, useTransform } from "motion/react";
import { useRef, type ReactNode } from "react";

type Testimonial = {
  quote: string;
  name: string;
  role: string;
  initials: string;
};

const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      "I stopped explaining the stack. People just ask how we ship every day, and honestly I let them wonder.",
    name: "Lena Ortiz",
    role: "Solo founder",
    initials: "LO",
  },
  {
    quote:
      "The approval gate is the whole product for me. I post what marketer.sh queues and it has never once embarrassed me.",
    name: "Theo Marchetti",
    role: "Creator",
    initials: "TM",
  },
  {
    quote:
      "Client content used to take my team a week of pulls and edits. Now I walk into the room with finished shorts.",
    name: "Amara Diallo",
    role: "Agency lead",
    initials: "AD",
  },
  {
    quote:
      "The cap is a promise. Work that would cross it is refused, not billed. That is the entire game.",
    name: "Jonas Lindqvist",
    role: "SaaS marketer",
    initials: "JL",
  },
  {
    quote:
      "I briefed a niche on the train and had a ranked article draft before the meeting. They asked who wrote it.",
    name: "Priya Raman",
    role: "Brand designer",
    initials: "PR",
  },
  {
    quote:
      "My calendar finally looks like the inside of my head. Fewer posts than other tools give you, but every one lands.",
    name: "Marcus Cole",
    role: "Ecommerce operator",
    initials: "MC",
  },
];

/** Column composition for the desktop parallax layout. */
const COLUMNS: number[][] = [
  [0, 3],
  [1, 4],
  [2, 5],
];

function QuoteCard({ testimonial }: { testimonial: Testimonial }): ReactNode {
  return (
    <figure className="border-border bg-background flex flex-col gap-8 rounded-3xl border p-7 sm:p-8">
      <blockquote className="text-foreground text-lg leading-relaxed font-medium tracking-tight text-balance">
        “{testimonial.quote}”
      </blockquote>
      <figcaption className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="border-border bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-medium tracking-wide"
        >
          {testimonial.initials}
        </span>
        <div>
          <p className="text-foreground text-sm font-medium">
            {testimonial.name}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {testimonial.role}
          </p>
        </div>
      </figcaption>
    </figure>
  );
}

export function Testimonials(): ReactNode {
  const reduce = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });

  const yLeft = useTransform(scrollYProgress, [0, 1], [40, -64]);
  const yMiddle = useTransform(scrollYProgress, [0, 1], [128, -24]);
  const yRight = useTransform(scrollYProgress, [0, 1], [72, -104]);
  const columnY = [yLeft, yMiddle, yRight];

  return (
    <section
      ref={sectionRef}
      id="reviews"
      className="mx-auto max-w-[1440px] scroll-mt-24 px-5 pb-24 sm:px-8 sm:pb-32 lg:px-10"
    >
      <SectionHeading
        title="Operators keep the receipts"
        description="Founders, creators, and agencies use marketer.sh where the work has to ship every day and the spend has to hold up."
      />

      {reduce ? (
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TESTIMONIALS.map((testimonial) => (
            <QuoteCard key={testimonial.name} testimonial={testimonial} />
          ))}
        </div>
      ) : (
        <>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:hidden">
            {TESTIMONIALS.map((testimonial) => (
              <QuoteCard key={testimonial.name} testimonial={testimonial} />
            ))}
          </div>

          <div className="mt-16 hidden grid-cols-3 gap-4 lg:grid">
            {COLUMNS.map((column, i) => (
              <motion.div
                key={column.join("-")}
                style={{ y: columnY[i] }}
                className="flex flex-col gap-4"
              >
                {column.map((index) => {
                  const testimonial = TESTIMONIALS[index];
                  if (!testimonial) return null;
                  return (
                    <QuoteCard
                      key={testimonial.name}
                      testimonial={testimonial}
                    />
                  );
                })}
              </motion.div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
