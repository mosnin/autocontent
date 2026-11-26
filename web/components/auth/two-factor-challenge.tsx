"use client";

import { useRouter } from "next/navigation";
import { StepFlow } from "@/design-system";
import { nextPath } from "./next-path";
import { TwoFactorStep } from "./steps";

/** /two-factor: the second step of a sign-in that started somewhere else (Google, a passkey on another page). */
export function TwoFactorChallenge({ next }: { next?: string | null }) {
  const router = useRouter();
  return (
    <div className="pt-16">
      <StepFlow step="two-factor" direction={1}>
        <TwoFactorStep
          onDone={() => {
            router.replace(nextPath(next));
            router.refresh();
          }}
        />
      </StepFlow>
    </div>
  );
}
