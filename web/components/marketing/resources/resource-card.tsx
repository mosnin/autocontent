import * as React from "react";
import Link from "next/link";

import { Kicker } from "@/components/marketing/system";
import { cn } from "@/lib/utils";

/**
 * Compact resources-hub card: kicker category, title, one-liner, quiet
 * arrow. Whole card is a link with a subtle hover lift.
 */
export function ResourceCard({
  category,
  title,
  description,
  href,
  className,
}: {
  category: string;
  title: string;
  description: string;
  href: string;
  className?: string;
}) {
  return (
    <Link
      className={cn(
        "group flex h-full flex-col rounded-[2rem] border border-zinc-900/[0.06] bg-white p-8 shadow-[0_8px_40px_rgba(15,23,42,0.06)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_16px_50px_rgba(15,23,42,0.10)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900",
        className,
      )}
      href={href}
    >
      <Kicker className="mb-3">{category}</Kicker>
      <h2 className="font-display text-xl font-semibold tracking-tight text-zinc-900 md:text-2xl">
        {title}
      </h2>
      <p className="mt-2 text-[15px] leading-relaxed text-zinc-600">
        {description}
      </p>
      <span className="mt-auto inline-flex items-center gap-1.5 pt-6 text-sm font-medium text-zinc-900">
        Read
        <svg
          aria-hidden
          className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </svg>
      </span>
    </Link>
  );
}
