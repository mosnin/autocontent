import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/auth/frame";
import { nextPath } from "@/components/auth/next-path";
import { TwoFactorSetup } from "@/components/auth/two-factor-setup";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Set up two-factor · Marketer" };

/** Where a workspace that requires two-factor sends people who haven't set it up. */
export default async function TwoFactorSetupPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const ctx = await requireSession("/two-factor/setup");
  const next = nextPath(q.next);
  if ((ctx.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled) redirect(next);
  return (
    <AuthFrame wide title="Set up two-factor" description={`${ctx.membership?.organizationName ?? "Your workspace"} requires a code from an authenticator app on top of your password.`}>
      <TwoFactorSetup next={next} />
    </AuthFrame>
  );
}
