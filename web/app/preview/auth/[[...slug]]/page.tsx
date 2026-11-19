// Fixture previews of the auth pages (no sign-in, no database), for design
// review and screenshots: /preview/auth/<page>?theme=light. The forms are the
// real components; submitting one calls the real API and fails harmlessly.

import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AcceptInvitation } from "@/components/auth/accept-invitation";
import { AuthFrame, TextLink } from "@/components/auth/frame";
import { ForgotPasswordForm, ResendVerification, ResetPasswordForm } from "@/components/auth/recovery-forms";
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
    <AuthFrame title="Sign in" description="Welcome back to your marketing department." footer={<>New to Marketer? <TextLink href="#">Create an account</TextLink></>}>
      <SignInForm google next={null} />
    </AuthFrame>
  ),
  "sign-in/verified": () => (
    <AuthFrame title="Sign in" description="Welcome back to your marketing department.">
      <SignInForm google={false} next={null} notice="Email verified. Sign in to continue." />
    </AuthFrame>
  ),
  "sign-up": () => (
    <AuthFrame title="Create your account" description="Your AI marketing department, set up around your brand in a few minutes." footer={<>Already have an account? <TextLink href="#">Sign in</TextLink></>}>
      <SignUpForm />
    </AuthFrame>
  ),
  "verify-email": () => (
    <AuthFrame title="Check your inbox" description="We sent a verification link to sam@pastaclub.co. Open it to finish creating your account." footer={<TextLink href="#">Back to sign in</TextLink>}>
      <p className="text-[13px] text-fg-muted">The link works for 24 hours. Didn&apos;t get it? Check spam, or send a new one.</p>
      <ResendVerification email="sam@pastaclub.co" />
    </AuthFrame>
  ),
  "forgot-password": () => (
    <AuthFrame title="Reset your password" description="We'll email you a link to choose a new one." footer={<TextLink href="#">Back to sign in</TextLink>}>
      <ForgotPasswordForm />
    </AuthFrame>
  ),
  "reset-password": () => (
    <AuthFrame title="Choose a new password" footer={<TextLink href="#">Back to sign in</TextLink>}>
      <ResetPasswordForm token="preview-token-not-real" />
    </AuthFrame>
  ),
  "two-factor": () => (
    <AuthFrame title="Enter your code" description="Open your authenticator app and type the six-digit code for Marketer." footer={<TextLink href="#">Start over</TextLink>}>
      <TwoFactorChallenge />
    </AuthFrame>
  ),
  "two-factor/setup": () => (
    <AuthFrame wide title="Set up two-factor" description="Pasta Club requires a code from an authenticator app on top of your password.">
      <TwoFactorSection title="Authenticator app" enabled={false} previewSetup={FX_TOTP} />
    </AuthFrame>
  ),
  "accept-invitation": () => (
    <AuthFrame title="Join Pasta Club" description="sam@pastaclub.co invited kim@pastaclub.co to this workspace.">
      <AcceptInvitation invitation={{ id: "inv_preview", organizationName: "Pasta Club", role: "analyst", inviterEmail: "sam@pastaclub.co" }} />
    </AuthFrame>
  ),
};

export default async function PreviewAuth({ params, searchParams }: { params: Promise<{ slug?: string[] }>; searchParams: Promise<{ theme?: string }> }) {
  const { slug = [] } = await params;
  const { theme } = await searchParams;
  const page = PAGES[slug.join("/") || "sign-in"];
  if (!page) notFound();
  return <div className={themeClass(theme === "light" ? "light" : "dark")}>{page()}</div>;
}
