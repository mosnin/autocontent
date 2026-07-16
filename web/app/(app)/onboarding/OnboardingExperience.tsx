"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { GradientText } from "@/components/ui/gradient-text";
import { completeOnboardingAction } from "@/lib/onboarding";
import { OnboardingEntry } from "./OnboardingEntry";

// An Apple-grade first run: a calm, full-bleed welcome that gives the moment
// room to breathe, then the channel builder itself. No decorative icons — just
// type, space, and one clear action at a time.
export function OnboardingExperience({
  connected,
  alreadyComplete = false,
}: {
  connected: boolean | null;
  alreadyComplete?: boolean;
}) {
  const [started, setStarted] = React.useState(false);
  const [skipping, setSkipping] = React.useState(false);

  // Self-heal: a user who already onboarded (metadata says so) landed here
  // only because this device lacks the mirror cookie — restore it and bounce
  // out without showing the welcome again.
  React.useEffect(() => {
    if (alreadyComplete) void completeOnboardingAction("/home");
  }, [alreadyComplete]);

  async function onSkip() {
    setSkipping(true);
    try {
      await completeOnboardingAction("/home");
    } catch {
      // redirect() throws internally on success; a real failure just
      // re-enables the link.
      setSkipping(false);
    }
  }

  if (alreadyComplete) {
    // One quiet beat while the self-heal redirect runs.
    return <div className="min-h-[70vh]" aria-busy />;
  }

  if (started) {
    return (
      <div className="mx-auto w-full max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Design your <GradientText>first channel</GradientText>
          </h1>
          <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
            A sentence is enough. The machine drafts the rest; you review, set a
            budget, and launch.
          </p>
        </div>
        <OnboardingEntry />
      </div>
    );
  }

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <div className="animate-in fade-in slide-in-from-bottom-3 duration-700">
        <p className="text-sm font-medium uppercase tracking-[0.28em] text-muted-foreground">
          Welcome to marketer.sh
        </p>
        <h1 className="mx-auto mt-6 max-w-3xl text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          Marketing that <GradientText>runs itself</GradientText>.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
          Describe a channel in a sentence. We&apos;ll produce the video, write
          the articles, and when you&apos;re ready, run the ads. Every dollar
          stays under a cap you set.
        </p>

        <div className="mt-10 flex flex-col items-center gap-4">
          <Button size="xl" pill onClick={() => setStarted(true)}>
            Create your first channel
          </Button>
          <button
            type="button"
            onClick={onSkip}
            disabled={skipping}
            className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-60"
          >
            {skipping ? "One moment…" : "Skip for now and explore the suite"}
          </button>
          {connected === false && (
            <p className="text-sm text-muted-foreground">
              Heads up: scheduled posts won&apos;t ship until you{" "}
              <a
                href="/connect"
                className="font-medium text-foreground underline underline-offset-4"
              >
                link a socials profile
              </a>
              . You can do that any time.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
