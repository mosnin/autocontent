import { redirect } from "next/navigation";
import { AuthFrame, TextLink } from "@/components/auth/frame";
import { nextPath, withNext } from "@/components/auth/next-path";
import { SignInForm } from "@/components/auth/sign-in-form";
import { getSession } from "@/lib/auth/session";

export const metadata = { title: "Sign in · Marketer" };

const NOTICES: Record<string, string> = {
  verified: "Email verified. Sign in to continue.",
  reset: "Password changed. Sign in with the new one.",
};
const ERRORS: Record<string, string> = {
  invalid_token: "That link is invalid or was already used.",
  token_expired: "That link has expired. Sign in to get a new one.",
  google: "Google sign-in didn't finish. Try again.",
  sso: "Single sign-on didn't finish. Try again or ask your admin.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const next = q.next ?? null;
  // A valid session goes straight on. (The middleware never redirects away from here on a cookie alone.)
  if (await getSession().catch(() => null)) redirect(nextPath(next));
  const error = q.error ? (ERRORS[q.error] ?? "Sign-in didn't finish. Try again.") : null;
  const notice = q.verified ? NOTICES.verified : q.reset ? NOTICES.reset : null;
  return (
    <AuthFrame
      title="Sign in"
      description={error ?? "Welcome back to your marketing department."}
      footer={
        <>
          New to Marketer? <TextLink href={withNext("/sign-up", next)}>Create an account</TextLink>
        </>
      }
    >
      <SignInForm next={next} google={Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)} notice={notice} />
    </AuthFrame>
  );
}
