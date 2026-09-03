import { BrandMark, type BrandTone } from "@/components/brand-logo";
import Link from "next/link";
import type { ReactNode } from "react";

export function Logo({
  href = "/",
  tone = "black",
}: {
  href?: string;
  tone?: BrandTone;
}): ReactNode {
  return (
    <Link
      href={href}
      aria-label="marketer.sh home"
      className="focus-ring group inline-flex"
    >
      <span className="flex h-13 w-13 items-center justify-center rounded-full border border-black/10 bg-white transition-transform duration-500 group-hover:-rotate-6 dark:border-white/15">
        <BrandMark tone={tone} priority className="w-9" />
      </span>
    </Link>
  );
}
