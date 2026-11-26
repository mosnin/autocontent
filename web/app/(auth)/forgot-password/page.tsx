import { AuthShell, TextLink } from "@/components/auth/frame";
import { ForgotPasswordForm } from "@/components/auth/recovery-forms";

export const metadata = { title: "Reset your password · Marketer" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell footer={<TextLink href="/sign-in">Back to sign in</TextLink>}>
      <ForgotPasswordForm />
    </AuthShell>
  );
}
