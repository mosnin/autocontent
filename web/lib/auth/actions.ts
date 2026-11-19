"use server";

// Server actions for the person's own sessions. Better Auth's HTTP
// list-sessions endpoint returns session tokens to the browser, so it is
// disabled (config.ts); the Security screen lists and revokes sessions here,
// by id, and tokens never leave the server.

import { headers } from "next/headers";

import { auth, authPool } from "./server";
import { getSession } from "./session";
import { createWorkspace, setActiveWorkspace } from "./workspace";

export interface SessionSummary {
  id: string;
  current: boolean;
  createdAt: string;
  updatedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export async function listMySessions(): Promise<SessionSummary[]> {
  const me = await getSession();
  if (!me) throw new Error("Sign in again.");
  const sessions = await auth().api.listSessions({ headers: await headers() });
  return sessions
    .map((s) => ({ id: s.id, current: s.id === me.session.id, createdAt: new Date(s.createdAt).toISOString(), updatedAt: new Date(s.updatedAt).toISOString(), ipAddress: s.ipAddress ?? null, userAgent: s.userAgent ?? null }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.updatedAt.localeCompare(a.updatedAt));
}

export async function revokeMySession(sessionId: string): Promise<void> {
  const me = await getSession();
  if (!me) throw new Error("Sign in again.");
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) throw new Error("That session doesn't exist.");
  // Only the person's own sessions: the lookup is scoped to their user id.
  const r = await authPool().query<{ token: string }>(`select token from auth.session where id = $1 and "userId" = $2 limit 1`, [sessionId, me.user.id]);
  const token = r.rows[0]?.token;
  if (!token) throw new Error("That session doesn't exist.");
  await auth().api.revokeSession({ headers: await headers(), body: { token } });
}

export async function revokeMyOtherSessions(): Promise<void> {
  await auth().api.revokeOtherSessions({ headers: await headers() });
}

/** "Create workspace" in the switcher: a new workspace with the person as owner, made active. */
export async function createAnotherWorkspace(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await getSession();
  if (!me) return { ok: false, error: "Sign in again." };
  const clean = typeof name === "string" ? name.trim().slice(0, 64) : "";
  if (!clean) return { ok: false, error: "Give the workspace a name." };
  try {
    const id = await createWorkspace(clean);
    await setActiveWorkspace(id);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return { ok: false, error: /maximum|limit/i.test(msg) ? "You've reached the workspace limit." : "Couldn't create the workspace. Try again." };
  }
}

/** Switch the active workspace. Only to one the person belongs to (Better Auth checks membership). */
export async function switchWorkspace(organizationId: string): Promise<{ ok: boolean }> {
  try {
    await setActiveWorkspace(organizationId);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
