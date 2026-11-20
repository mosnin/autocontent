import { assessInjection } from "@agent-starter/core";
import type { Context } from "hono";
import { z } from "zod";

/** Header the in-app sidebar sends with page/entity context (URI-encoded JSON object). */
export const APP_CONTEXT_HEADER = "x-agent-context";
export const MAX_APP_CONTEXT_BYTES = 4096;

const Scalar = z.union([z.string().max(512), z.number(), z.boolean(), z.null()]);
const AppContextSchema = z
  .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/), z.union([Scalar, z.array(Scalar).max(20)]))
  .refine((value) => Object.keys(value).length <= 32, "at most 32 keys");

/** Identity keys are server-derived (agentAuth); a client can never set them through app context. */
const RESERVED = new Set(["tenantid", "tenant_id", "tenant", "userid", "user_id", "roles", "scopes", "environment", "mode", "orgid", "org_id"]);

/**
 * Validated, size-limited app context for in-app agents, used as agentAuth's
 * `extraInitialData`. Returns `{ context }` or undefined when the header is
 * missing, too large, not a flat JSON object, or looks like a prompt injection.
 * Flue records initialData when a conversation is created, so this seeds the
 * conversation's first page; per-message context still rides in each message
 * (AgentSidebar `context`).
 */
export function appContextFromRequest(c: Context): { context: Record<string, unknown> } | undefined {
  const raw = c.req.header(APP_CONTEXT_HEADER);
  if (!raw || raw.length > MAX_APP_CONTEXT_BYTES * 3) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return undefined;
  }
  if (new TextEncoder().encode(decoded).length > MAX_APP_CONTEXT_BYTES) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(decoded);
  } catch {
    return undefined;
  }
  const parsed = AppContextSchema.safeParse(json);
  if (!parsed.success) return undefined;
  const context = Object.fromEntries(Object.entries(parsed.data).filter(([key]) => !RESERVED.has(key.toLowerCase())));
  if (Object.keys(context).length === 0) return undefined;
  if (assessInjection(JSON.stringify(context)).score >= 0.6) return undefined;
  return { context };
}
