// Fixture previews of the auth pages (no sign-in, no database), for design
// review and screenshots: /preview/auth/<page>?theme=light. The forms are the
// real components; submitting one calls the real API and fails harmlessly.

import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AcceptInvitation } from "@/components/auth/accept-invitation";
import { AuthFrame, AuthShell, TextLink } from "@/components/auth/frame";
import { ForgotPasswordForm, ResetPasswordForm, VerifyEmailForm } from "@/components/auth/recovery-forms";
import { TwoFactorSection } from "@/components/auth/security-settings";
import { SignInForm } from "@/components/auth/sign-in-form";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { TwoFactorChallenge } from "@/components/auth/two-factor-challenge";
import { themeClass } from "@/components/shell/theme";

export const dynamic = "force-dynamic";

// A made-up secret: not a real account's.
const FX_TOTP = { totpURI: "otpauth://totp/Marketer:sam%40pastaclub.co?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Marketer", backupCodes: ["k3j9x-2m4pq", "z8w1r-7t5ny", "c6v0b-1h3dk", "p2l8m-9f4qs", "e7u5t-0g2jr", "a1s9d-4k8wz", "n3b7v-6c0xm", "q5w2e-8r1ty", "u9i4o-3p7la", "h6j0k-2l5zx"] };

const PAGES: Record<string, () => ReactNode> = {
  "sign-in": () => (
    <AuthShell footer={<>New to Marketer? <TextLink href="#">Create an account</TextLink></>}>
      <SignInForm google next={null} />
    </AuthShell>
  ),
  "sign-in/verified": () => (
    <AuthShell>
      <SignInForm google={false} next={null} notice="Email verified. Sign in to continue." email="sam@pastaclub.co" />
    </AuthShell>
  ),
  "sign-up": () => (
    <AuthShell footer={<>Already have an account? <TextLink href="#">Sign in</TextLink></>}>
      <SignUpForm google />
    </AuthShell>
  ),
  "verify-email": () => (
    <AuthShell footer={<TextLink href="#">Back to sign in</TextLink>}>
      <VerifyEmailForm email="sam@pastaclub.co" />
    </AuthShell>
  ),
  "forgot-password": () => (
    <AuthShell footer={<TextLink href="#">Back to sign in</TextLink>}>
      <ForgotPasswordForm />
    </AuthShell>
  ),
  "reset-password": () => (
    <AuthShell footer={<TextLink href="#">Back to sign in</TextLink>}>
      <ResetPasswordForm token="preview-token-not-real" />
    </AuthShell>
  ),
  "two-factor": () => (
    <AuthShell footer={<TextLink href="#">Start over</TextLink>}>
      <TwoFactorChallenge />
    </AuthShell>
  ),
  "two-factor/setup": () => (
    <AuthFrame wide title="Set up two-factor" description="Pasta Club requires a code from an authenticator app on top of your password.">
      <TwoFactorSection title="Authenticator app" enabled={false} previewSetup={FX_TOTP} />
    </AuthFrame>
  ),
  "accept-invitation": () => (
    <AuthShell>
      <AcceptInvitation email="kim@pastaclub.co" invitation={{ id: "inv_preview", organizationName: "Pasta Club", role: "analyst", inviterEmail: "sam@pastaclub.co" }} />
    </AuthShell>
  ),
};

export default async function PreviewAuth({ params, searchParams }: { params: Promise<{ slug?: string[] }>; searchParams: Promise<{ theme?: string }> }) {
  const { slug = [] } = await params;
  const { theme } = await searchParams;
  const page = PAGES[slug.join("/") || "sign-in"];
  if (!page) notFound();
  return <div className={themeClass(theme === "light" ? "light" : "dark")}>{page()}</div>;
}
