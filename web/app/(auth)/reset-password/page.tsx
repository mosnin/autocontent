import { AuthFrame, AuthShell, TextLink } from "@/components/auth/frame";
import { ResetPasswordForm } from "@/components/auth/recovery-forms";

export const metadata = { title: "Choose a new password · Marketer" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const token = q.token && /^[A-Za-z0-9_-]{8,256}$/.test(q.token) ? q.token : null;
  if (!token || q.error)
    return (
      <AuthFrame title="This link doesn't work" description="It has expired or was already used. Reset links work once, for an hour." footer={<TextLink href="/sign-in">Back to sign in</TextLink>}>
        <TextLink href="/forgot-password">Send a new link</TextLink>
      </AuthFrame>
    );
  return (
    <AuthShell footer={<TextLink href="/sign-in">Back to sign in</TextLink>}>
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
