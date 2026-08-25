import { auth } from "@clerk/nextjs/server";

import { api } from "@/lib/api";

/**
 * Server-only admin gate. Clerk `userId` only proves a session exists;
 * the product's admin role lives in the API DB and is never trusted from
 * a token claim. Fail closed if the role cannot be confirmed.
 */
export type AdminGate =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403 };

export async function requireAdmin(): Promise<AdminGate> {
  let userId: string | null = null;
  try {
    const session = await auth();
    userId = session.userId;
  } catch {
    return { ok: false, status: 401 };
  }
  if (!userId) return { ok: false, status: 401 };

  try {
    const me = await api<{ role?: string }>("/api/v1/users/me");
    if (me.role !== "admin") return { ok: false, status: 403 };
    return { ok: true, userId };
  } catch {
    return { ok: false, status: 403 };
  }
}
