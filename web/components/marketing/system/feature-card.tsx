import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { Kicker } from "./typography";

/**
 * Big floating feature panel: illustration up top, kicker + title + copy
 * below, quiet arrow link at the bottom. Whole card is clickable.
 */
export function FeatureCard({
  title,
  description,
  href,
  linkLabel = "Learn more",
  kicker,
  illustration,
  className,
}: {
  title: string;
  description: string;
  href: string;
  linkLabel?: string;
  kicker?: string;
  illustration?: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      className={cn(
        "group flex h-full flex-col overflow-hidden rounded-[2rem] border border-zinc-900/[0.06] bg-white shadow-[0_8px_40px_rgba(15,23,42,0.06)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_16px_50px_rgba(15,23,42,0.10)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900",
        className,
      )}
      href={href}
    >
      {illustration ? (
        <div className="border-b border-zinc-900/[0.04] bg-[radial-gradient(110%_110%_at_50%_-10%,#f0f4ff_0%,#fafafa_70%)] px-6 pt-8 pb-4">
          {illustration}
        </div>
      ) : null}
      <div className="flex flex-1 flex-col p-8">
        {kicker ? <Kicker className="mb-3">{kicker}</Kicker> : null}
        <h3 className="font-display text-xl font-semibold tracking-tight text-zinc-900 md:text-2xl">
          {title}
        </h3>
        <p className="mt-2 max-w-md text-[15px] leading-relaxed text-zinc-600">
          {description}
        </p>
        <span className="mt-auto inline-flex items-center gap-1.5 pt-6 text-sm font-medium text-zinc-900">
          {linkLabel}
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
      </div>
    </Link>
  );
}
