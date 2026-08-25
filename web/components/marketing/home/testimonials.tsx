"use client";

import { SectionHeading } from "@/components/marketing/section-heading";
import { useReducedMotion } from "@/lib/marketing/motion";
import { motion, useScroll, useTransform } from "motion/react";
import Image from "next/image";
import { useRef, type ReactNode } from "react";

type Testimonial = {
  quote: string;
  name: string;
  role: string;
  avatar: string;
};

const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      "I stopped explaining the stack. People just ask how we ship every day, and honestly I let them wonder.",
    name: "Lena Ortiz",
    role: "Solo founder",
    avatar:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?q=80&w=160&h=160&auto=format&fit=crop&crop=faces",
  },
  {
    quote:
      "The approval gate is the whole product for me. I post what marketer.sh queues and it has never once embarrassed me.",
    name: "Theo Marchetti",
    role: "Creator",
    avatar:
      "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?q=80&w=160&h=160&auto=format&fit=crop&crop=faces",
  },
  {
    quote:
      "Client content used to take my team a week of pulls and edits. Now I walk into the room with finished shorts.",
    name: "Amara Diallo",
    role: "Agency lead",
    avatar:
      "https://images.unsplash.com/photo-1589156280159-27698a70f29e?q=80&w=160&h=160&auto=format&fit=crop&crop=faces",
  },
  {
    quote:
      "The cap is a promise. Work that would cross it is refused, not billed. That is the entire game.",
    name: "Jonas Lindqvist",
    role: "SaaS marketer",
    avatar:
      "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=160&h=160&auto=format&fit=crop&crop=faces",
  },
  {
    quote:
      "I briefed a niche on the train and had a ranked article draft before the meeting. They asked who wrote it.",
    name: "Priya Raman",
    role: "Brand designer",
    avatar:
      "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?q=80&w=160&h=160&auto=format&fit=crop&crop=faces",
  },
  {
    quote:
      "My calendar finally looks like the inside of my head. Fewer posts than other tools give you, but every one lands.",
    name: "Marcus Cole",
    role: "Ecommerce operator",
    avatar:
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=160&h=160&auto=format&fit=crop&crop=faces",
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
        <Image
          src={testimonial.avatar}
          alt={testimonial.name}
          width={80}
          height={80}
          unoptimized
          className="border-border size-10 shrink-0 rounded-full border object-cover"
        />
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
