import { createPersistentControlRoutes } from "@agent-starter/cloudflare";
import type { PersistentEnv } from "./env.ts";

/**
 * Control-plane HTTP API (session bearer token; the DO is `<session tid>/<agentId>`, never a tenant from the URL):
 *   GET  /api/persistent/:agentId                         status, config, last 20 turns   (owner or admin)
 *   PUT  /api/persistent/:agentId/config                  { config, expectedVersion }; 0 creates (admin); widening
 *                                                         changes come back 202 as a proposal
 *   GET  /api/persistent/:agentId/proposals?status=       proposals                      (owner or admin)
 *   POST /api/persistent/:agentId/proposals/:id/approve|reject  { note? }                (owner or admin)
 *   POST /api/persistent/:agentId/disable|enable          kill switch                    (owner or admin)
 *   GET  /api/persistent/:agentId/audit?cursor=&limit=    append-only audit log          (security or admin role)
 *   POST /api/persistent/:agentId/memory/snapshot|rollback, GET …/memory/snapshots      (owner or admin)
 * web/PersistentAgentConsole.tsx (PersistentAgentPanel) is the UI for it.
 */
export const persistentRoutes = createPersistentControlRoutes<PersistentEnv>({
  namespace: (env) => {
    if (!env.PERSISTENT_CONTROL) throw new Error("PERSISTENT_CONTROL Durable Object binding is missing");
    return env.PERSISTENT_CONTROL;
  },
  sessionSecrets: (c) => [c.env.SESSION_SIGNING_SECRET, c.env.SESSION_SIGNING_SECRET_PREVIOUS].filter(Boolean) as string[],
  adminRoles: ["admin"],
  securityRoles: ["security", "admin"],
  creatorRoles: ["admin"],
});
