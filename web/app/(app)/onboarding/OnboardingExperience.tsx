"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { OnboardingEntry } from "./OnboardingEntry";

export function OnboardingExperience({
  connected,
}: {
  connected: boolean | null;
}) {
  const [started, setStarted] = React.useState(false);

  if (started) {
    return (
      <div className="mx-auto w-full max-w-2xl pt-10">
        <div className="mb-10 text-center">
          <h1 className="text-foreground text-[clamp(30px,4.5vw,48px)] leading-[1.05] font-medium tracking-tight">
            Design your first channel
          </h1>
          <p className="text-muted-foreground mx-auto mt-4 max-w-md text-base leading-relaxed">
            A sentence is enough — the machine drafts the rest. You review, set
            a budget, and launch.
          </p>
        </div>
        <OnboardingEntry />
      </div>
    );
  }

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
      <h1 className="text-foreground max-w-3xl text-[clamp(44px,7.5vw,84px)] leading-[1.02] font-medium tracking-tight text-balance">
        Marketing that runs itself
      </h1>
      <p className="text-muted-foreground mx-auto mt-6 max-w-md text-base leading-relaxed">
        Describe a channel in a sentence. We&apos;ll produce the video, write
        the articles, and — when you&apos;re ready — run the ads. Every dollar
        stays under a cap you set.
      </p>
      <div className="mt-10 flex flex-col items-center gap-4">
        <Button
          className="h-13 rounded-full px-8 text-sm font-medium"
          onClick={() => setStarted(true)}
          pill
          size="xl"
        >
          Create your first channel
        </Button>
        {connected === false && (
          <p className="text-muted-foreground text-sm">
            Scheduled posts won&apos;t ship until you{" "}
            <a
              href="/connect"
              className="text-foreground font-medium underline underline-offset-4"
            >
              link a socials profile
            </a>
            . You can do that any time.
          </p>
        )}
      </div>
    </div>
  );
}
