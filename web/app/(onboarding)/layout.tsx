import { ClerkProvider } from "@clerk/nextjs";
import { cookies } from "next/headers";
import { THEME_COOKIE, themeClass } from "@/components/shell/theme";

export const dynamic = "force-dynamic";

/** Onboarding runs full-screen, outside the app shell (no sidebar until there's proof). Dark by default. */
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get(THEME_COOKIE)?.value === "light" ? "light" : "dark";
  return (
    <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up">
      <div className={themeClass(theme)}>{children}</div>
    </ClerkProvider>
  );
}
