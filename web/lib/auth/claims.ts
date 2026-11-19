// Claims for the tokens web mints. Pure, so the Node test runner can check
// them against the contract in docs/auth/README.md.

import { permissionsFor, type AssignableRole } from "./catalog.ts";

export const BACKEND_AUDIENCE = "marketer-api";
export const BACKEND_TOKEN_TTL_SECONDS = 5 * 60;

export interface BackendJwtInput {
  user: { id: string; email: string };
  session: { id: string; activeOrganizationId?: string | null };
}

/**
 * The payload of the backend JWT, minus iss/aud/exp/iat, which signBackendJwt
 * adds. `org` is required: a session with no active workspace gets no token.
 */
export function backendJwtPayload(input: BackendJwtInput, now: number = Date.now()): { sub: string; sid: string; org: string; email: string; iat: number; exp: number } {
  const org = input.session.activeOrganizationId;
  if (!input.user?.id || !input.session?.id) throw new Error("a session is required");
  if (!org) throw new Error("no active workspace");
  const iat = Math.floor(now / 1000);
  return { sub: input.user.id, sid: input.session.id, org, email: input.user.email ?? "", iat, exp: iat + BACKEND_TOKEN_TTL_SECONDS };
}

export interface AgentTokenInput {
  personId: string;
  tenantId: string;
  role: AssignableRole;
}

/** sub = person, tid = tenant, roles = [role], scopes = the role's permissions. */
export function agentTokenClaims(input: AgentTokenInput): { sub: string; tid: string; roles: string[]; scopes: string[] } {
  if (!input.personId) throw new Error("a person is required");
  if (!input.tenantId) throw new Error("a tenant is required");
  const scopes = permissionsFor(input.role);
  if (scopes.length === 0) throw new Error("the role grants nothing");
  return { sub: input.personId, tid: input.tenantId, roles: [input.role], scopes: [...scopes] };
}
