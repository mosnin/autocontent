import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { THEME_COOKIE, themeClass } from "@/components/shell/theme";
import { requireSession } from "@/lib/auth/session";
import { ensureWorkspace } from "@/lib/auth/workspace";

export const dynamic = "force-dynamic";

/**
 * Onboarding runs full-screen, outside the app shell (no sidebar until there's proof). Dark by default.
 *
 * A signed-in person with no workspace gets one here, named from their email
 * domain, before any backend call; it is renamed when they confirm their
 * brand. Someone with a pending invitation is sent to accept it instead, so
 * joining a team never creates an extra workspace.
 */
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSession("/onboarding");
  if (!ctx.user.emailVerified) redirect(`/verify-email?email=${encodeURIComponent(ctx.user.email)}`);
  const ws = await ensureWorkspace(ctx, { create: true });
  if (ws.kind === "invited") redirect(`/accept-invitation/${encodeURIComponent(ws.invitationId)}`);
  // A workspace was just created or chosen: load again so this request's session acts in it.
  if (!ctx.membership) redirect("/onboarding");
  const theme = (await cookies()).get(THEME_COOKIE)?.value === "light" ? "light" : "dark";
  return <div className={themeClass(theme)}>{children}</div>;
}
