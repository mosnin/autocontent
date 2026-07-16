import type { Metadata } from "next";

import { GradientText } from "@/components/ui/gradient-text";
import { OnboardingEntry } from "../../onboarding/OnboardingEntry";

export const metadata: Metadata = { title: "New channel" };

// Standalone channel builder. The onboarding gate first-runs new accounts
// through /onboarding, but returning users reach the exact same flow here
// from any "New channel" button. No self-heal redirect, so the button
// always opens the builder instead of bouncing an onboarded user home.
export default function NewChannelPage() {
  return (
    <div className="mx-auto w-full max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Design a <GradientText>new channel</GradientText>
        </h1>
        <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
          A sentence is enough. The machine drafts the rest; you review, set a
          budget, and launch.
        </p>
      </div>
      <OnboardingEntry />
    </div>
  );
}
