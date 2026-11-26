import { AuthShell, TextLink } from "@/components/auth/frame";
import { TwoFactorChallenge } from "@/components/auth/two-factor-challenge";

export const metadata = { title: "Two-factor check · Marketer" };

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  return (
    <AuthShell footer={<TextLink href="/sign-in">Start over</TextLink>}>
      <TwoFactorChallenge next={q.next ?? null} />
    </AuthShell>
  );
}
