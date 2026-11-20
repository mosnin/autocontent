import { AuthFrame, TextLink } from "@/components/auth/frame";
import { TwoFactorChallenge } from "@/components/auth/two-factor-challenge";

export const metadata = { title: "Two-factor check · Marketer" };

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  return (
    <AuthFrame title="Enter your code" description="Open your authenticator app and type the six-digit code for Marketer." footer={<TextLink href="/sign-in">Start over</TextLink>}>
      <TwoFactorChallenge next={q.next ?? null} />
    </AuthFrame>
  );
}
