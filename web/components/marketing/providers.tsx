"use client";

import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { markIntroDone } from "@/lib/marketing/intro";
import { ReducedMotionProvider } from "@/lib/marketing/motion";

import { SmoothScroll } from "./smooth-scroll";

function IntroGate(): null {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/") {
      markIntroDone();
    }
  }, [pathname]);

  return null;
}

export function MarketingProviders({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <ReducedMotionProvider>
      <IntroGate />
      <SmoothScroll>{children}</SmoothScroll>
    </ReducedMotionProvider>
  );
}
