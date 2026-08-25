"use client";

import { SectionHeading } from "@/components/marketing/section-heading";
import { InView, useReducedMotion } from "@/lib/marketing/motion";
import { cn } from "@/lib/utils";
import { ArrowUpRight } from "lucide-react";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useVelocity,
} from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useRef, useState, type MouseEvent, type ReactNode } from "react";

type Feature = {
  title: string;
  href: string;
  body: string;
  image: string;
};

const FEATURES: Feature[] = [
  {
    title: "Content",
    href: "/features/content",
    body: "Short videos for TikTok, Reels, and Shorts. Your agent writes them, makes them, and can post them.",
    image:
      "https://images.unsplash.com/photo-1779881718722-5e7fa09fad7f?q=80&w=770&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  },
  {
    title: "SEO",
    href: "/features/seo",
    body: "Blog posts from what people already search, plus a check-up for pages you already have live.",
    image:
      "https://images.unsplash.com/photo-1778051131564-192e359b601d?q=80&w=774&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  },
  {
    title: "Ads",
    href: "/features/ads",
    body: "Paid ads on Google and Meta. The agent drafts them. Your budget is the limit.",
    image:
      "https://images.unsplash.com/photo-1779630541798-1f3d987aa440?q=80&w=770&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  },
];

const SPRING = { stiffness: 200, damping: 24, mass: 0.6 };

export function Features(): ReactNode {
  const prefersReducedMotion = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const previewX = useSpring(mouseX, SPRING);
  const previewY = useSpring(mouseY, SPRING);
  const velocity = useVelocity(previewX);
  const tilt = useTransform(velocity, [-1200, 1200], [-8, 8]);
  const rotate = useSpring(tilt, { stiffness: 260, damping: 30 });

  const handleMove = (event: MouseEvent<HTMLDivElement>): void => {
    const rect = listRef.current?.getBoundingClientRect();
    if (!rect) return;
    mouseX.set(event.clientX - rect.left);
    mouseY.set(event.clientY - rect.top);
  };

  return (
    <section id="overview" className="scroll-mt-24 pb-24 sm:pb-32">
      <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10">
        <SectionHeading
          title="Three things it can make for you."
          description="Content, SEO, and ads. Same login. Same prepaid credits. Same daily budget."
        />
      </div>

      <div
        ref={listRef}
        onMouseMove={prefersReducedMotion ? undefined : handleMove}
        onMouseLeave={() => setActive(null)}
        className="border-border relative mt-16 border-t"
      >
        {FEATURES.map((feature, i) => (
          <InView key={feature.title}>
            <div
              onMouseEnter={() => setActive(i)}
              className="group border-border border-b"
            >
              <Link
                href={feature.href}
                className="mx-auto flex max-w-[1440px] items-center gap-5 px-5 py-8 sm:gap-8 sm:px-8 sm:py-12 lg:px-10"
              >
                <span className="text-muted-foreground w-8 shrink-0 font-mono text-xs">
                  0{i + 1}
                </span>
                <div className="flex flex-1 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-12">
                  <h3 className="text-foreground text-2xl font-medium tracking-tight transition-transform duration-500 ease-out sm:text-4xl lg:group-hover:translate-x-3">
                    {feature.title}
                  </h3>
                  <p className="text-muted-foreground max-w-md text-sm leading-relaxed lg:max-w-xs">
                    {feature.body}
                  </p>
                </div>
                <Image
                  src={feature.image}
                  alt=""
                  width={128}
                  height={160}
                  unoptimized
                  className="h-20 w-16 shrink-0 rounded-xl object-cover lg:hidden"
                />
                <ArrowUpRight
                  className="text-foreground hidden size-6 shrink-0 -translate-x-2 opacity-0 transition-all duration-500 ease-out group-hover:translate-x-0 group-hover:opacity-100 lg:block"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
              </Link>
            </div>
          </InView>
        ))}

        {!prefersReducedMotion && (
          <motion.div
            style={{ x: previewX, y: previewY, rotate }}
            aria-hidden="true"
            className="pointer-events-none absolute top-0 left-0 z-10 hidden lg:block"
          >
            <motion.div
              initial={false}
              animate={{
                opacity: active !== null ? 1 : 0,
                scale: active !== null ? 1 : 0.85,
              }}
              transition={{ type: "spring", stiffness: 320, damping: 28 }}
              className="relative -mt-44 ml-10 w-[230px] overflow-hidden rounded-2xl shadow-[0_30px_70px_-25px_rgba(0,0,0,0.45)]"
            >
              {FEATURES.map((feature, i) => (
                <motion.div
                  key={feature.title}
                  initial={false}
                  animate={{ opacity: active === i ? 1 : 0 }}
                  transition={{ duration: 0.25 }}
                  className={cn(i > 0 && "absolute inset-0")}
                >
                  <Image
                    src={feature.image}
                    alt=""
                    width={460}
                    height={614}
                    unoptimized
                    className="aspect-[3/4] w-full object-cover"
                  />
                </motion.div>
              ))}
            </motion.div>
          </motion.div>
        )}
      </div>
    </section>
  );
}
