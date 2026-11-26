// Owner console for a persistent (always-on) agent: status, next heartbeat, kill switch, recent turns with
// auto-review decisions, pending proposals (approve / reject) and, for security roles, the audit log.
// Install: @agent-starter/react. The session token is minted by YOUR backend (see web/host-routes.example.ts);
// the Worker checks owner / admin / security roles on every route, so the props below only shape the UI.
"use client";
import { PersistentAgentPanel } from "@agent-starter/react";
import "@agent-starter/react/styles.css";

const AGENT_ORIGIN = process.env.NEXT_PUBLIC_AGENT_ORIGIN ?? "http://localhost:5173";

export function PersistentAgentConsole({ agentId, sessionToken, roles }: { agentId: string; sessionToken: string; roles: string[] }) {
  return (
    <PersistentAgentPanel
      endpoint={`${AGENT_ORIGIN}/api/persistent`}
      agentId={agentId}
      token={sessionToken}
      credentials="omit"
      // Roles granting audit:read (docs/auth/permissions.json). The audit route answers 403 for everyone else; this only avoids the request.
      canReadAudit={roles.includes("owner") || roles.includes("admin")}
    />
  );
}

/**
 * Creating an agent (tenant admins): PUT the first config with expectedVersion 0. Everything but identity has a
 * secure default (30 min heartbeat, no egress, no credentials, $5/day, 20 tool calls per tick, auto-review on).
 */
export async function createPersistentAgent(sessionToken: string, input: { agentId: string; name: string; ownerUserId: string; heartbeat?: string }): Promise<unknown> {
  const response = await fetch(`${AGENT_ORIGIN}/api/persistent/${encodeURIComponent(input.agentId)}/config`, {
    method: "PUT",
    headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
    body: JSON.stringify({ config: input, expectedVersion: 0 }),
  });
  if (!response.ok) throw new Error(`Creating the agent failed with HTTP ${response.status}`);
  return response.json();
}
