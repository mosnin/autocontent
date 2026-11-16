import { ClerkProvider, UserButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/mk/shell/app-shell";
import { RunConfirmProvider } from "@/components/run-confirm-dialog";
import type { SetupStep } from "@/components/mk/shell/getting-started";
import type { BrandKit } from "@/lib/brand-kit-client";
import type { AyrshareConnectStatus, Job, Niche, User } from "@/lib/types";
import { getInbox, safe } from "@/lib/workspace-server";

// Every protected page renders Clerk's <UserButton /> in the sidebar, so
// static prerender would need a real Clerk key. Keep the group dynamic.
export const dynamic = "force-dynamic";

/**
 * One shell for the whole product (see PRODUCT_GOAL.md): a quiet sidebar and
 * the page, fed by real workspace state. Every fetch degrades to null so the
 * shell renders even when the API is down.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [user, inbox, niches, ayrshare, jobs, brand, adAccounts] = await Promise.all([
    safe<User & { role?: string }>("/api/v1/users/me"),
    getInbox(),
    safe<Niche[]>("/api/v1/niches"),
    safe<AyrshareConnectStatus>("/api/v1/connect/ayrshare/status"),
    safe<Job[]>("/api/v1/jobs?limit=1"),
    safe<BrandKit>("/api/v1/brand-kit"),
    safe<unknown[]>("/api/v1/ads/accounts"),
  ]);

  // A brand-new workspace starts in onboarding. Only when the API positively
  // reports nothing (empty arrays, no brand), never when it's unreachable.
  if (niches && jobs && brand && niches.length === 0 && jobs.length === 0 && !brand.brand_name) redirect("/onboarding");

  const steps: SetupStep[] = [
    { id: "brand", label: "Tell Marketer about your brand", detail: "Name, voice and audience steer everything it makes.", href: "/brand", done: Boolean(brand?.brand_name) },
    { id: "playbook", label: "Create your first playbook", detail: "Who to talk to, how to sound, what to make.", href: "/playbooks/new", done: (niches?.length ?? 0) > 0 },
    { id: "channels", label: "Connect your channels", detail: "TikTok, Reels and Shorts, so posts go out on schedule.", href: "/integrations", done: Boolean(ayrshare?.connected) },
    { id: "first", label: "Make your first piece", detail: "Ask Marketer for a video or an article.", href: "/sessions/new?q=Make%20my%20first%20video", done: (jobs?.length ?? 0) > 0 },
    { id: "ads", label: "Connect an ad account", detail: "Optional. Let the Media buyer run paid inside your caps.", href: "/paid/connect", done: (adAccounts?.length ?? 0) > 0 },
  ];

  return (
    <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up">
      <AppShell data={{ brandName: brand?.brand_name || "Marketer", inbox, steps, isAdmin: user?.role === "admin" }} account={<UserButton appearance={{ elements: { avatarBox: "size-7" } }} />}>
        <RunConfirmProvider>{children}</RunConfirmProvider>
      </AppShell>
    </ClerkProvider>
  );
}
