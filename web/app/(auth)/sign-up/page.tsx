import { redirect } from "next/navigation";
import { AuthFrame, TextLink } from "@/components/auth/frame";
import { nextPath, withNext } from "@/components/auth/next-path";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { getSession } from "@/lib/auth/session";

export const metadata = { title: "Create your account · Marketer" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const next = q.next ?? null;
  if (await getSession().catch(() => null)) redirect(nextPath(next));
  return (
    <AuthFrame
      title="Create your account"
      description="Your AI marketing department, set up around your brand in a few minutes."
      footer={
        <>
          Already have an account? <TextLink href={withNext("/sign-in", next)}>Sign in</TextLink>
        </>
      }
    >
      <SignUpForm next={next} email={q.email ?? null} />
    </AuthFrame>
  );
}
