"use server";

import { authPool } from "@/lib/auth/server";

/**
 * Whether an email's domain signs in with single sign-on (a verified SSO
 * provider on some workspace). Domain-level only: it says nothing about
 * whether this address has an account, and never names the workspace.
 */
export async function ssoForEmail(email: string): Promise<boolean> {
  const domain = typeof email === "string" ? email.trim().toLowerCase().split("@")[1] ?? "" : "";
  if (!/^[a-z0-9.-]{3,253}$/.test(domain) || !domain.includes(".")) return false;
  try {
    const r = await authPool().query<{ n: number }>(
      `select count(*)::int as n from auth."ssoProvider"
        where "domainVerified" is true and $1 = any(string_to_array(replace(lower(domain), ' ', ''), ','))`,
      [domain],
    );
    return (r.rows[0]?.n ?? 0) > 0;
  } catch {
    return false;
  }
}
