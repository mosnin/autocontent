"use client";

import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { ArrowRight } from "lucide-react";

import { Reveal } from "@/components/marketing/reveal";
import TextBurnNeon from "@/components/pixel-perfect/text-burn-neon";
import { Button } from "@/components/ui/button";

export function FinalCta() {
  return (
    <section className="relative isolate overflow-hidden py-32">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[30rem] opacity-60"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 100%, hsl(var(--brand) / 0.16), transparent 70%)",
        }}
      />
      <div className="mx-auto flex w-full max-w-4xl flex-col items-center px-6 text-center">
        <TextBurnNeon
          className="text-5xl font-semibold tracking-tight sm:text-7xl"
          repeat={false}
        >
          Ship tonight.
        </TextBurnNeon>
        <Reveal delay={0.15}>
          <p className="mt-6 max-w-xl text-balance text-lg text-muted-foreground">
            Your first niche takes three minutes to describe. The machine
            handles every night after that.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <SignedIn>
              <Button asChild size="xl">
                <Link href="/dashboard">
                  Open your dashboard
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </SignedIn>
            <SignedOut>
              <Button asChild size="xl">
                <Link href="/sign-in">
                  Start a channel
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </SignedOut>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
