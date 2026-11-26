import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { UserMenu } from "@/components/auth/account-menu";
import { AppShell } from "@/components/shell/app-shell";
import { THEME_COOKIE, type AppTheme } from "@/components/shell/theme";
import type { SetupStep } from "@/components/shell/getting-started";
import { listMemberships, needsTwoFactor, requireSession } from "@/lib/auth/session";
import { ensureWorkspace } from "@/lib/auth/workspace";
import type { BillingAccess } from "@/lib/billing-access";
import type { BrandKit } from "@/lib/brand-kit-client";
import type { AyrshareConnectStatus, Job, Niche } from "@/lib/types";
import { shellInbox } from "@/lib/workspace";
import { getInbox, safe } from "@/lib/workspace-server";

// Every page reads the session and the workspace on the server.
export const dynamic = "force-dynamic";

/**
 * One shell for the whole product (see PRODUCT_GOAL.md): a quiet sidebar and
 * the page, fed by real workspace state.
 *
 * Before anything renders, on the server: a valid session (else sign-in), a
 * verified email, an active workspace the person belongs to (none yet:
 * onboarding, or the pending invitation), and two-factor when the workspace
 * requires it. Every backend fetch degrades to null so the shell renders even
 * when the API is down.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const here = h.get("x-pathname") || "/home";
  const ctx = await requireSession(here);
  if (!ctx.user.emailVerified) redirect(`/verify-email?email=${encodeURIComponent(ctx.user.email)}`);

  const ws = await ensureWorkspace(ctx, { create: false });
  if (ws.kind === "invited") redirect(`/accept-invitation/${encodeURIComponent(ws.invitationId)}`);
  if (ws.kind === "none") redirect("/onboarding");
  // The active workspace was just chosen: this request's session is stale, so load the page again.
  if (!ctx.membership) redirect(here);
  const membership = ws.membership;
  if (needsTwoFactor({ ...ctx, membership })) redirect(`/two-factor/setup?next=${encodeURIComponent(here)}`);

  const theme = ((await cookies()).get(THEME_COOKIE)?.value === "light" ? "light" : "dark") as AppTheme;
  const [all, inbox, niches, ayrshare, jobs, brand, adAccounts, access] = await Promise.all([
    listMemberships(ctx.user.id),
    getInbox(),
    safe<Niche[]>("/api/v1/niches"),
    safe<AyrshareConnectStatus>("/api/v1/connect/ayrshare/status"),
    safe<Job[]>("/api/v1/jobs?limit=1"),
    safe<BrandKit>("/api/v1/brand-kit"),
    safe<unknown[]>("/api/v1/ads/accounts"),
    safe<BillingAccess>("/api/v1/billing/access"),
  ]);

  // A brand-new workspace starts in onboarding. Only when the API positively
  // reports nothing (empty arrays, no brand), never when it's unreachable.
  if (niches && jobs && brand && niches.length === 0 && jobs.length === 0 && !brand.brand_name) redirect("/onboarding");
  // Nothing to run on (billing on, no credit, never bought, no code): the plan
  // screen comes before the dashboard (docs/billing/access-codes.md). Only when
  // the API positively says so; an unreachable API never blocks the app.
  if (access?.needs_plan) redirect(`/plans?next=${encodeURIComponent(here)}`);

  const steps: SetupStep[] = [
    { id: "brand", label: "Tell Marketer about your brand", detail: "Name, voice and audience steer everything it makes.", href: "/brand", done: Boolean(brand?.brand_name) },
    { id: "playbook", label: "Create your first playbook", detail: "Who to talk to, how to sound, what to make.", href: "/playbooks/new", done: (niches?.length ?? 0) > 0 },
    { id: "channels", label: "Connect your channels", detail: "TikTok, Reels and Shorts, so posts go out on schedule.", href: "/integrations", done: Boolean(ayrshare?.connected) },
    { id: "first", label: "Make your first piece", detail: "Ask Marketer for a video or an article.", href: "/sessions/new?q=Make%20my%20first%20video", done: (jobs?.length ?? 0) > 0 },
    { id: "ads", label: "Connect an ad account", detail: "Optional. Let the Media buyer run paid inside your caps.", href: "/paid/connect", done: (adAccounts?.length ?? 0) > 0 },
  ];

  const workspaces = all.map((m) => ({ id: m.organizationId, name: m.organizationName, role: m.role }));
  const current = workspaces.find((w) => w.id === membership.organizationId) ?? { id: membership.organizationId, name: membership.organizationName, role: membership.role };

  return (
    <AppShell
      data={{
        brandName: brand?.brand_name || membership.organizationName,
        inbox: shellInbox(inbox),
        steps,
        isAdmin: (ctx.user as { role?: string | null }).role === "admin",
        workspace: { current, all: workspaces },
      }}
      permissions={membership.permissions}
      theme={theme}
      account={<UserMenu name={ctx.user.name} email={ctx.user.email} />}
    >
      {children}
    </AppShell>
  );
}
