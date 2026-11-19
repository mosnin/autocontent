// Design-review preview of onboarding (no sign-in, no API: activation falls back gracefully).
import { OnboardingFlow } from "@/components/app/onboarding/flow";
import { themeClass } from "@/components/shell/theme";

export default async function PreviewOnboarding({ searchParams }: { searchParams: Promise<{ theme?: string }> }) {
  const { theme } = await searchParams;
  return (
    <div className={themeClass(theme === "light" ? "light" : "dark")}>
      <OnboardingFlow email="sam@pastaclub.co" displayName="Sam Rossi" inferredBrand="Pastaclub" inferredWebsite="pastaclub.co" savedBrand={null} channelsConnected={false} />
    </div>
  );
}
