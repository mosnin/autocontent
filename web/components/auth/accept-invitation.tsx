"use client";

import { useState } from "react";
import { Button, Notice } from "@/design-system";
import { roleDescription, roleLabel } from "@/lib/auth/catalog";
import { authClient, authErrorMessage } from "@/lib/auth/client";

export interface InvitationView {
  id: string;
  organizationName: string;
  role: string;
  inviterEmail: string;
}

/** Accept or decline, for the invited address only (the server checks the email matches). */
export function AcceptInvitation({ invitation }: { invitation: InvitationView }) {
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

  const accept = async () => {
    if (busy) return;
    setBusy("accept");
    setError(null);
    const { data, error } = await authClient.organization.acceptInvitation({ invitationId: invitation.id });
    if (error) {
      setBusy(null);
      return setError(authErrorMessage(error, "The invitation couldn't be accepted."));
    }
    const orgId = (data as { member?: { organizationId?: string } } | null)?.member?.organizationId;
    if (orgId) await authClient.organization.setActive({ organizationId: orgId });
    window.location.assign("/home");
  };

  const reject = async () => {
    if (busy) return;
    setBusy("reject");
    setError(null);
    const { error } = await authClient.organization.rejectInvitation({ invitationId: invitation.id });
    setBusy(null);
    if (error) return setError(authErrorMessage(error));
    setDeclined(true);
  };

  if (declined) return <p className="text-[13px] text-fg-muted">You declined. You can close this page.</p>;

  return (
    <div className="space-y-4">
      <div className="rounded-ds-md border border-hairline bg-surface-2 px-3 py-2.5 text-[13px]">
        <div>
          <span className="text-fg-muted">Role</span> <span className="font-medium">{roleLabel(invitation.role)}</span>
        </div>
        <p className="mt-1 text-[12px] text-fg-muted">{roleDescription(invitation.role)}</p>
      </div>
      <Notice error={error} />
      <div className="flex gap-2">
        <Button variant="primary" size="lg" className="flex-1" onClick={() => void accept()} loading={busy === "accept"} disabled={busy !== null}>
          Join {invitation.organizationName}
        </Button>
        <Button size="lg" onClick={() => void reject()} loading={busy === "reject"} disabled={busy !== null}>
          Decline
        </Button>
      </div>
    </div>
  );
}
