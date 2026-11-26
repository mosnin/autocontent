// Design-review preview of onboarding (no sign-in, no API: activation falls back gracefully). ?plan=1: a workspace with no credit, whose last step goes to the plan screen.
import { OnboardingFlow } from "@/components/app/onboarding/flow";
import { themeClass } from "@/components/shell/theme";

export default async function PreviewOnboarding({ searchParams }: { searchParams: Promise<{ theme?: string; plan?: string }> }) {
  const { theme, plan } = await searchParams;
  return (
    <div className={themeClass(theme === "light" ? "light" : "dark")}>
      <OnboardingFlow email="sam@pastaclub.co" displayName="Sam Rossi" inferredBrand="Pastaclub" inferredWebsite="pastaclub.co" savedBrand={null} channelsConnected={false} needsPlan={plan === "1"} />
    </div>
  );
}
