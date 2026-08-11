"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import type { FaqItem } from "./faq-data";

/**
 * Accessible accordion: one item open at a time, full button/region ARIA
 * wiring. The panel is shown and hidden outright rather than animated, so
 * there is nothing to strand half-open if JS is slow to arrive.
 */
export function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = React.useState<number | null>(0);

  return (
    <div>
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div className="os-disclosure" key={item.q}>
            <h2>
              <button
                aria-controls={`faq-panel-${i}`}
                aria-expanded={isOpen}
                className="os-disclosure__btn"
                id={`faq-button-${i}`}
                onClick={() => setOpen(isOpen ? null : i)}
                type="button"
              >
                <span>{item.q}</span>
                <span
                  aria-hidden
                  className={cn(
                    "os-disclosure__sign",
                    isOpen && "os-disclosure__sign--open",
                  )}
                >
                  <svg
                    fill="none"
                    height="13"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    width="13"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
              </button>
            </h2>
            {isOpen ? (
              <div
                aria-labelledby={`faq-button-${i}`}
                className="os-disclosure__body"
                id={`faq-panel-${i}`}
                role="region"
              >
                {item.a}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
