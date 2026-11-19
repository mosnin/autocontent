import { createPersistentControlRoutes } from "@agent-starter/cloudflare";
import { rolesGranting } from "../lib/permissions.ts";
import type { PersistentEnv } from "./env.ts";

/**
 * Control-plane HTTP API (session bearer token; the DO is `<session tid>/<agentId>`, never a tenant from the URL):
 *   GET  /api/persistent/:agentId                         status, config, last 20 turns   (its owner, or security:manage)
 *   PUT  /api/persistent/:agentId/config                  { config, expectedVersion }; 0 creates (security:manage); widening
 *                                                         changes come back 202 as a proposal
 *   GET  /api/persistent/:agentId/proposals?status=       proposals                      (its owner, or security:manage)
 *   POST /api/persistent/:agentId/proposals/:id/approve|reject  { note? }                (its owner, or security:manage)
 *   POST /api/persistent/:agentId/disable|enable          kill switch                    (its owner, or security:manage)
 *   GET  /api/persistent/:agentId/audit?cursor=&limit=    append-only audit log          (audit:read)
 *   POST /api/persistent/:agentId/memory/snapshot|rollback, GET …/memory/snapshots      (its owner, or security:manage)
 * web/PersistentAgentConsole.tsx (PersistentAgentPanel) is the UI for it.
 */
export const persistentRoutes = createPersistentControlRoutes<PersistentEnv>({
  namespace: (env) => {
    if (!env.PERSISTENT_CONTROL) throw new Error("PERSISTENT_CONTROL Durable Object binding is missing");
    return env.PERSISTENT_CONTROL;
  },
  sessionSecrets: (c) => [c.env.SESSION_SIGNING_SECRET, c.env.SESSION_SIGNING_SECRET_PREVIOUS].filter(Boolean) as string[],
  // Roles from the catalog (docs/auth/agent.md): managing any autopilot and creating one (it spends on its own) are
  // operator controls, `security:manage`; the append-only audit log is `audit:read`. Owner or admin today.
  adminRoles: rolesGranting("security:manage"),
  securityRoles: rolesGranting("audit:read"),
  creatorRoles: rolesGranting("security:manage"),
});
