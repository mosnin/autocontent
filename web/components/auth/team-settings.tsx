"use client";

import { MailPlus, RotateCw, UserMinus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, ConfirmModal, EmptyLine, Field, Input, List, ListRow, NotAllowed, Notice, PersonAvatar, Section, Select, StatusBadge, Time, useAllowed, usePending } from "@/design-system";
import { ASSIGNABLE_ROLES, roleDescription, roleLabel, type AssignableRole } from "@/lib/auth/catalog";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { checkRemoval, checkRoleChange, countOwners, grantableRoles } from "@/lib/auth/rules";

export interface TeamMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

export interface TeamInvitation {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
}

export interface TeamProps {
  organizationId: string;
  me: { memberId: string; userId: string; role: AssignableRole };
  members: TeamMember[];
  invitations: TeamInvitation[];
  /** Fixture previews: show the screen without calling the API. */
  preview?: boolean;
}

/** Settings → Team: members and their roles, invitations, and what each role means. */
export function TeamSettings({ organizationId, me, members, invitations, preview }: TeamProps) {
  const router = useRouter();
  const canInvite = useAllowed("member:invite");
  const canChange = useAllowed("member:update_role");
  const canRemove = useAllowed("member:remove");
  const grantable = grantableRoles(me.role);
  const owners = countOwners(members);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableRole>(grantable.includes("analyst") ? "analyst" : (grantable[grantable.length - 1] ?? "analyst"));
  const [inviteNote, setInviteNote] = useState<{ ok?: string; error?: string } | null>(null);
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const rowOps = usePending<string>();
  const removeOp = usePending<"remove">();

  const refresh = () => router.refresh();

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    if (inviting || preview) return;
    setInviting(true);
    setInviteNote(null);
    const { error } = await authClient.organization.inviteMember({ email: email.trim(), role, organizationId });
    setInviting(false);
    if (error) return setInviteNote({ error: authErrorMessage(error, "The invitation wasn't sent.") });
    setInviteNote({ ok: `Invitation sent to ${email.trim()}.` });
    setEmail("");
    refresh();
  };

  const changeRole = (m: TeamMember, next: AssignableRole) =>
    void rowOps.run(`role:${m.id}`, async () => {
      if (preview) return;
      const { error } = await authClient.organization.updateMemberRole({ memberId: m.id, role: next, organizationId });
      if (error) throw new Error(authErrorMessage(error, "The role wasn't changed."));
      refresh();
    });

  return (
    <>
      <Section title="People">
        <List>
          {members.map((m) => {
            const self = m.id === me.memberId;
            const changeable = canChange && !self;
            const removable = checkRemoval({ actor: me, target: { memberId: m.id, userId: m.userId, role: m.role }, ownerCount: owners });
            return (
              <ListRow key={m.id}>
                <PersonAvatar name={m.name || m.email} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13px]">
                    <span className="truncate">{m.name || m.email}</span>
                    {self && <StatusBadge>You</StatusBadge>}
                  </div>
                  <div className="truncate text-[12px] text-fg-muted">{m.email}</div>
                </div>
                {changeable ? (
                  <div className="w-[132px] shrink-0">
                    <Select
                      aria-label={`Role for ${m.name || m.email}`}
                      value={m.role}
                      disabled={rowOps.busy !== null}
                      onChange={(e) => changeRole(m, e.target.value as AssignableRole)}
                    >
                      {ASSIGNABLE_ROLES.map((r) => {
                        const ok = r === m.role || checkRoleChange({ actor: me, target: { memberId: m.id, userId: m.userId, role: m.role }, newRole: r, ownerCount: owners }).ok;
                        return (
                          <option key={r} value={r} disabled={!ok}>
                            {roleLabel(r)}
                          </option>
                        );
                      })}
                    </Select>
                  </div>
                ) : (
                  <span className="shrink-0 text-[12.5px] text-fg-muted">{roleLabel(m.role)}</span>
                )}
                {(canRemove || self) && (
                  <Button size="sm" variant="ghost" aria-label={self ? "Leave workspace" : `Remove ${m.name || m.email}`} title={removable.ok ? undefined : removable.message} disabled={!removable.ok} onClick={() => (removeOp.setError(null), setRemoving(m))}>
                    <UserMinus /> <span className="sr-only sm:not-sr-only">{self ? "Leave" : "Remove"}</span>
                  </Button>
                )}
              </ListRow>
            );
          })}
        </List>
        <Notice error={rowOps.error} />
      </Section>

      <Section title="Invite someone">
        {canInvite ? (
          <form onSubmit={invite} className="space-y-3 rounded-ds-lg border border-hairline bg-surface p-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
              <Field label="Email">
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
              </Field>
              <Field label="Role">
                <Select value={role} onChange={(e) => setRole(e.target.value as AssignableRole)} aria-label="Role for the invitation">
                  {grantable.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <p className="text-[12px] text-fg-muted">{roleDescription(role)} The invitation works for 72 hours, only for that address.</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="primary" loading={inviting}>
                <MailPlus /> Send invitation
              </Button>
              <Notice inline ok={inviteNote?.ok} error={inviteNote?.error} />
            </div>
          </form>
        ) : (
          <NotAllowed>Owners and admins invite people.</NotAllowed>
        )}
      </Section>

      {canInvite && (
        <Section title="Pending invitations">
          {invitations.length === 0 ? (
            <EmptyLine>No pending invitations.</EmptyLine>
          ) : (
            <List>
              {invitations.map((inv) => (
                <ListRow key={inv.id}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]">{inv.email}</div>
                    <div className="text-[12px] text-fg-muted">
                      {roleLabel(inv.role)} · expires <Time iso={inv.expiresAt} />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={rowOps.busy === `resend:${inv.id}`}
                    disabled={rowOps.busy !== null}
                    onClick={() =>
                      void rowOps.run(`resend:${inv.id}`, async () => {
                        if (preview) return;
                        const { error } = await authClient.organization.inviteMember({ email: inv.email, role: inv.role as AssignableRole, organizationId, resend: true });
                        if (error) throw new Error(authErrorMessage(error, "It wasn't resent."));
                        refresh();
                      })
                    }
                  >
                    <RotateCw /> Resend
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Cancel the invitation to ${inv.email}`}
                    loading={rowOps.busy === `cancel:${inv.id}`}
                    disabled={rowOps.busy !== null}
                    onClick={() =>
                      void rowOps.run(`cancel:${inv.id}`, async () => {
                        if (preview) return;
                        const { error } = await authClient.organization.cancelInvitation({ invitationId: inv.id });
                        if (error) throw new Error(authErrorMessage(error, "It wasn't cancelled."));
                        refresh();
                      })
                    }
                  >
                    <X /> Cancel
                  </Button>
                </ListRow>
              ))}
            </List>
          )}
        </Section>
      )}

      <Section title="Roles">
        <List>
          {ASSIGNABLE_ROLES.map((r) => (
            <ListRow key={r}>
              <div className="w-[88px] shrink-0 text-[13px] font-medium">{roleLabel(r)}</div>
              <div className="min-w-0 flex-1 text-[12.5px] text-fg-muted">{roleDescription(r)}</div>
            </ListRow>
          ))}
        </List>
      </Section>

      <ConfirmModal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={removing?.id === me.memberId ? "Leave this workspace?" : `Remove ${removing?.name || removing?.email}?`}
        confirmLabel={removing?.id === me.memberId ? "Leave" : "Remove"}
        danger
        busy={removeOp.busy === "remove"}
        error={removeOp.error}
        onConfirm={() =>
          void removeOp.run("remove", async () => {
            if (preview || !removing) return;
            const self = removing.id === me.memberId;
            const { error } = self ? await authClient.organization.leave({ organizationId }) : await authClient.organization.removeMember({ memberIdOrEmail: removing.id, organizationId });
            if (error) throw new Error(authErrorMessage(error, "That didn't work."));
            setRemoving(null);
            if (self) window.location.assign("/home");
            else refresh();
          })
        }
      >
        <p>{removing?.id === me.memberId ? "You lose access to this workspace's work at once." : "They lose access at once. Their sessions in this workspace stop within seconds."}</p>
      </ConfirmModal>
    </>
  );
}
