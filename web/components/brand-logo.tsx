import Image from "next/image";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type BrandTone = "black" | "gradient";

const MARKS: Record<BrandTone, string> = {
  black: "/brand/marketer-mark-black.png",
  gradient: "/brand/marketer-mark-gradient.png",
};

export function BrandMark({
  tone = "black",
  className,
  priority = false,
}: {
  tone?: BrandTone;
  className?: string;
  priority?: boolean;
}): ReactNode {
  return (
    <Image
      src={MARKS[tone]}
      alt=""
      width={1332}
      height={618}
      priority={priority}
      className={cn("h-auto w-full", className)}
    />
  );
}

export function BrandWordmark({
  className,
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}): ReactNode {
  return (
    <Image
      src="/brand/marketer-wordmark-black.png"
      alt="marketer.sh"
      width={1600}
      height={232}
      priority={priority}
      className={cn("h-auto w-full", className)}
    />
  );
}
