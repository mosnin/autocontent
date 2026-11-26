"use client";

import { useState } from "react";
import { Notice, Step, StepFlow, StepLink, WorkspaceLogo } from "@/design-system";
import { roleDescription, roleLabel } from "@/lib/auth/catalog";
import { authClient, authErrorMessage } from "@/lib/auth/client";

export interface InvitationView {
  id: string;
  organizationName: string;
  role: string;
  inviterEmail: string;
}

/** Join or decline, for the invited address only (the server checks the email matches). */
export function AcceptInvitation({ invitation, email }: { invitation: InvitationView; email?: string }) {
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

  const accept = async () => {
    if (busy) return;
    setBusy("accept");
    setError(null);
    const { data, error: err } = await authClient.organization.acceptInvitation({ invitationId: invitation.id });
    if (err) {
      setBusy(null);
      return setError(authErrorMessage(err, "The invitation couldn't be accepted."));
    }
    const orgId = (data as { member?: { organizationId?: string } } | null)?.member?.organizationId;
    if (orgId) await authClient.organization.setActive({ organizationId: orgId });
    window.location.assign("/home");
  };

  const reject = async () => {
    if (busy) return;
    setBusy("reject");
    setError(null);
    const { error: err } = await authClient.organization.rejectInvitation({ invitationId: invitation.id });
    setBusy(null);
    if (err) return setError(authErrorMessage(err));
    setDeclined(true);
  };

  return (
    <StepFlow step={declined ? "declined" : "invite"} direction={1}>
      {declined ? (
        <Step title="You declined" subtitle={`${invitation.inviterEmail} won't be told why. You can close this page.`} />
      ) : (
        <Step
          title={`Join ${invitation.organizationName}`}
          subtitle={`${invitation.inviterEmail} invited ${email ?? "you"} to this workspace.`}
          onSubmit={() => void accept()}
          primary={{ label: `Join ${invitation.organizationName}`, loading: busy === "accept", disabled: busy === "reject" }}
          secondary={
            <StepLink onClick={() => void reject()} disabled={busy !== null}>
              Decline
            </StepLink>
          }
        >
          <div className="flex items-start gap-3 rounded-ds-lg border border-hairline bg-surface px-4 py-3.5">
            <WorkspaceLogo name={invitation.organizationName} size={36} />
            <div className="min-w-0">
              <div className="text-[14.5px] font-medium">You&apos;ll join as {roleLabel(invitation.role)}</div>
              <p className="mt-0.5 text-[13px] leading-relaxed text-fg-muted">{roleDescription(invitation.role)}</p>
            </div>
          </div>
          <div className="mt-3 min-h-5">
            <Notice error={error} />
          </div>
        </Step>
      )}
    </StepFlow>
  );
}
