import { AuthFrame, TextLink } from "@/components/auth/frame";
import { ForgotPasswordForm } from "@/components/auth/recovery-forms";

export const metadata = { title: "Reset your password · Marketer" };

export default function ForgotPasswordPage() {
  return (
    <AuthFrame title="Reset your password" description="We'll email you a link to choose a new one." footer={<TextLink href="/sign-in">Back to sign in</TextLink>}>
      <ForgotPasswordForm />
    </AuthFrame>
  );
}
