import { AcceptInvitation } from "@/components/auth/accept-invitation";
import { AuthFrame, AuthShell, TextLink } from "@/components/auth/frame";
import { withNext } from "@/components/auth/next-path";
import { ButtonLink } from "@/design-system";
import { authPool } from "@/lib/auth/server";
import { getSession } from "@/lib/auth/session";

export const metadata = { title: "Join a workspace · Marketer" };

interface Row {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: Date;
  name: string;
  inviterEmail: string;
}

export default async function AcceptInvitationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const here = `/accept-invitation/${encodeURIComponent(id)}`;
  const session = await getSession().catch(() => null);
  if (!session)
    return (
      <AuthFrame title="You're invited" description="Sign in or create an account with the address the invitation was sent to." footer={<TextLink href="/">What is Marketer?</TextLink>}>
        <div className="flex flex-col gap-2">
          <ButtonLink href={withNext("/sign-up", here)} variant="primary" size="xl" className="w-full">
            Create an account
          </ButtonLink>
          <ButtonLink href={withNext("/sign-in", here)} variant="ghost" size="lg" className="w-full">
            I already have an account
          </ButtonLink>
        </div>
      </AuthFrame>
    );

  // Only the invited address sees the details (Better Auth enforces the same when accepting).
  const valid = /^[A-Za-z0-9_-]{1,128}$/.test(id);
  const r = valid
    ? await authPool().query<Row>(
        `select i.id, i.email, i.role, i.status, i."expiresAt", o.name, u.email as "inviterEmail"
           from auth.invitation i join auth.organization o on o.id = i."organizationId" join auth."user" u on u.id = i."inviterId"
          where i.id = $1 limit 1`,
        [id],
      )
    : { rows: [] as Row[] };
  const inv = r.rows[0];
  const usable = inv && inv.status === "pending" && new Date(inv.expiresAt) > new Date() && inv.email.toLowerCase() === session.user.email.toLowerCase();
  if (!usable)
    return (
      <AuthFrame title="This invitation doesn't work" description={`It may have expired, been cancelled, or been sent to another address. You're signed in as ${session.user.email}.`} footer={<TextLink href="/home">Go to Marketer</TextLink>}>
        <p className="text-[13px] text-fg-muted">Ask the person who invited you to send a new one.</p>
      </AuthFrame>
    );
  return (
    <AuthShell>
      <AcceptInvitation email={session.user.email} invitation={{ id: inv.id, organizationName: inv.name, role: inv.role, inviterEmail: inv.inviterEmail }} />
    </AuthShell>
  );
}
