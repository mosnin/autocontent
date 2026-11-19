"use client";

// The browser's Better Auth client. It talks to /api/auth on this origin with
// the httpOnly session cookie; it never sees a backend JWT.

import { passkeyClient } from "@better-auth/passkey/client";
import { ssoClient } from "@better-auth/sso/client";
import { inferOrgAdditionalFields, organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { ac, roles } from "./access";

export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [
    organizationClient({
      ac,
      roles,
      teams: { enabled: false },
      schema: inferOrgAdditionalFields({ organization: { additionalFields: { tenantId: { type: "string", input: false }, requireTwoFactor: { type: "boolean", required: false } } } }),
    }),
    twoFactorClient({
      onTwoFactorRedirect() {
        const next = new URLSearchParams(window.location.search).get("next");
        window.location.href = `/two-factor${next ? `?next=${encodeURIComponent(next)}` : ""}`;
      },
    }),
    passkeyClient(),
    ssoClient(),
  ],
});

/** A Better Auth error as one short sentence for a Notice. Never the raw response. */
export function authErrorMessage(error: { message?: string | null; status?: number; code?: string | null } | null | undefined, fallback = "Something went wrong. Try again."): string {
  if (!error) return fallback;
  if (error.status === 429) return "Too many attempts. Wait a minute and try again.";
  const m = (error.message ?? "").trim();
  return m && m.length <= 200 ? m : fallback;
}
