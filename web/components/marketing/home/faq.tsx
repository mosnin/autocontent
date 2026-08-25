"use client";

import { FAQ_ITEMS } from "@/components/marketing/resources/faq-data";
import { SectionHeading } from "@/components/marketing/section-heading";
import { softEase, useReducedMotion } from "@/lib/marketing/motion";
import { Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";

type QA = {
  question: string;
  answer: string;
};

const FAQS: QA[] = FAQ_ITEMS.slice(0, 7).map((item) => ({
  question: item.q,
  answer: item.a,
}));

function FaqItem({
  item,
  index,
  isOpen,
  onToggle,
}: {
  item: QA;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
}): ReactNode {
  const prefersReducedMotion = useReducedMotion();
  const panelId = `faq-panel-${index}`;
  const buttonId = `faq-button-${index}`;

  return (
    <div className="border-border border-t last:border-b">
      <h3>
        <button
          id={buttonId}
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={onToggle}
          className="focus-ring flex w-full items-center justify-between gap-6 py-6 text-left"
        >
          <span className="text-foreground text-base font-medium tracking-tight sm:text-lg">
            {item.question}
          </span>
          <motion.span
            animate={{ rotate: isOpen ? 45 : 0 }}
            transition={
              prefersReducedMotion
                ? { duration: 0.01 }
                : { duration: 0.3, ease: softEase }
            }
            className="text-muted-foreground shrink-0"
          >
            <Plus className="size-5" strokeWidth={1.75} aria-hidden="true" />
          </motion.span>
        </button>
      </h3>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={panelId}
            role="region"
            aria-labelledby={buttonId}
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={
              prefersReducedMotion
                ? { duration: 0.01 }
                : { duration: 0.4, ease: softEase }
            }
            className="overflow-hidden"
          >
            <p className="text-muted-foreground max-w-2xl pb-7 text-sm leading-relaxed">
              {item.answer}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Faq(): ReactNode {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section
      id="faq"
      className="mx-auto max-w-[1440px] scroll-mt-24 px-5 pb-24 sm:px-8 sm:pb-32 lg:px-10"
    >
      <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
        <SectionHeading
          title="Fair questions, straight answers"
          description={
            <>
              Anything else, write to{" "}
              <a
                href="mailto:hello@marketer.sh"
                className="focus-ring text-foreground underline underline-offset-4 transition-opacity hover:opacity-70"
              >
                hello@marketer.sh
              </a>
              . A person reads every single message.
            </>
          }
        />

        <div>
          {FAQS.map((item, i) => (
            <FaqItem
              key={item.question}
              item={item}
              index={i}
              isOpen={openIndex === i}
              onToggle={() => setOpenIndex((cur) => (cur === i ? null : i))}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
