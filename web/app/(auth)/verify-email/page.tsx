import { AuthFrame, TextLink } from "@/components/auth/frame";
import { ResendVerification } from "@/components/auth/recovery-forms";

export const metadata = { title: "Verify your email · Marketer" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const email = q.email?.slice(0, 320) ?? null;
  return (
    <AuthFrame
      title="Check your inbox"
      description={email ? `We sent a verification link to ${email}. Open it to finish creating your account.` : "We sent you a verification link. Open it to finish creating your account."}
      footer={<TextLink href="/sign-in">Back to sign in</TextLink>}
    >
      <p className="text-[13px] text-fg-muted">The link works for 24 hours. Didn&apos;t get it? Check spam, or send a new one.</p>
      <ResendVerification email={email} />
    </AuthFrame>
  );
}
