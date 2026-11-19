import "server-only";

// Workspace lifecycle on the server: choosing the active workspace, creating
// the first one, and noticing a pending invitation before creating anything.

import { headers } from "next/headers";

import { authPool, auth } from "./server";
import { listMemberships, membershipIn, type AuthContext, type Membership } from "./session";

const PERSONAL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com", "gmx.com", "hey.com", "fastmail.com"]);

/** A first workspace's name, from the email domain ("acme-foods.com" → "Acme Foods"). Renamed when the person confirms their brand. */
export function workspaceNameFromEmail(email: string): string {
  const domain = email.split("@")[1]?.toLowerCase().trim() ?? "";
  if (!domain || PERSONAL.has(domain)) return "My workspace";
  const label = domain.replace(/^(www|mail|app)\./, "").split(".")[0] ?? "";
  const name = label
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return name.slice(0, 64) || "My workspace";
}

/** The id of a live invitation to this address, if any. */
export async function pendingInvitationFor(email: string): Promise<string | null> {
  const r = await authPool().query<{ id: string }>(
    `select id from auth.invitation where lower(email) = lower($1) and status = 'pending' and "expiresAt" > now() order by "createdAt" desc limit 1`,
    [email],
  );
  return r.rows[0]?.id ?? null;
}

export async function setActiveWorkspace(organizationId: string): Promise<void> {
  await auth().api.setActiveOrganization({ headers: await headers(), body: { organizationId } });
}

export async function createWorkspace(name: string): Promise<string> {
  // slug is replaced by the beforeCreateOrganization hook (config.ts), which also sets the tenant id.
  const org = await auth().api.createOrganization({ headers: await headers(), body: { name: name.slice(0, 64), slug: `w-${crypto.randomUUID()}` } });
  if (!org?.id) throw new Error("workspace was not created");
  return org.id;
}

export type WorkspaceState = { kind: "ready"; membership: Membership } | { kind: "invited"; invitationId: string } | { kind: "none" };

/**
 * Make sure the session acts in a workspace the person belongs to. A stale or
 * missing active workspace becomes their first membership. With no
 * membership at all: a pending invitation wins ("invited"); otherwise "none",
 * and only onboarding creates one (`create: true`).
 */
export async function ensureWorkspace(ctx: AuthContext, opts: { create: boolean }): Promise<WorkspaceState> {
  if (ctx.membership) return { kind: "ready", membership: ctx.membership };
  const all = await listMemberships(ctx.user.id);
  if (all[0]) {
    await setActiveWorkspace(all[0].organizationId);
    return { kind: "ready", membership: all[0] };
  }
  const invitationId = await pendingInvitationFor(ctx.user.email);
  if (invitationId) return { kind: "invited", invitationId };
  if (!opts.create) return { kind: "none" };
  // Two requests can land here at once (a prefetch and a navigation, two tabs).
  // A per-person advisory lock makes the first one create and the others find
  // it. Try-lock and poll, so a waiting request never holds a pooled connection.
  const key = `marketer:first-workspace:${ctx.user.id}`;
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    const client = await authPool().connect();
    let locked = false;
    try {
      locked = (await client.query<{ ok: boolean }>(`select pg_try_advisory_lock(hashtextextended($1, 0)) as ok`, [key])).rows[0]?.ok === true;
      if (locked) {
        const again = await listMemberships(ctx.user.id);
        const orgId = again[0]?.organizationId ?? (await createWorkspace(workspaceNameFromEmail(ctx.user.email)));
        await setActiveWorkspace(orgId);
        const m = await membershipIn(ctx.user.id, orgId);
        if (!m) throw new Error("workspace membership missing after creation");
        return { kind: "ready", membership: m };
      }
    } finally {
      if (locked) await client.query(`select pg_advisory_unlock(hashtextextended($1, 0))`, [key]).catch(() => undefined);
      client.release();
    }
    await new Promise((r) => setTimeout(r, 200));
    const found = await listMemberships(ctx.user.id);
    if (found[0]) {
      await setActiveWorkspace(found[0].organizationId);
      return { kind: "ready", membership: found[0] };
    }
  }
  throw new Error("timed out creating the first workspace");
}
