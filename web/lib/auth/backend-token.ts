import "server-only";

// The backend JWT (docs/auth/README.md, "Contract: the backend JWT"): RS256,
// iss = BETTER_AUTH_URL, aud = marketer-api, 5 minutes, sub/sid/org/email.
// Minted here, per request, through the jwt plugin's server-only signJWT
// endpoint. It is attached by lib/api.ts and /api/proxy and never sent to the
// browser; the plugin's HTTP /token endpoint is disabled in config.ts.

import { backendJwtPayload } from "./claims";
import { auth } from "./server";
import { getSession } from "./session";

/** A token for the current session, or null when signed out or not acting in a workspace. */
export async function mintBackendToken(): Promise<string | null> {
  const s = await getSession();
  if (!s || !s.session.activeOrganizationId) return null;
  const payload = backendJwtPayload({ user: { id: s.user.id, email: s.user.email }, session: { id: s.session.id, activeOrganizationId: s.session.activeOrganizationId } });
  const { token } = await auth().api.signJWT({ body: { payload } });
  return token;
}
