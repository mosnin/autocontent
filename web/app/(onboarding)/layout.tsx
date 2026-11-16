import { ClerkProvider } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

/** Onboarding runs full-screen, outside the app shell (no sidebar until there's proof). */
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up">
      {children}
    </ClerkProvider>
  );
}
