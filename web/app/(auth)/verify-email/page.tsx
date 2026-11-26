import { AuthShell, TextLink } from "@/components/auth/frame";
import { VerifyEmailForm } from "@/components/auth/recovery-forms";

export const metadata = { title: "Verify your email · Marketer" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const email = q.email?.slice(0, 320) ?? null;
  return (
    <AuthShell footer={<TextLink href="/sign-in">Back to sign in</TextLink>}>
      <VerifyEmailForm email={email} next={q.next ?? null} />
    </AuthShell>
  );
}
