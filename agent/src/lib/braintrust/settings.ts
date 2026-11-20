import type { ContentMode } from "./config.ts";

/**
 * The workspace's observability setting (docs/observability/braintrust.md, rule 4): `GET {PRIMARY_SAAS_API_URL}
 * /api/v1/observability/settings` returns `{ "content": "redacted" | "metadata" }`. Read with the agent service token
 * and the workspace in `x-tenant-id`, exactly like the Marketer API client. Cached 60 s per workspace. Anything we
 * cannot read (no backend configured, timeout, non-2xx, an unexpected body) means `metadata`.
 */

export const SETTINGS_PATH = "/api/v1/observability/settings";
const TTL_MS = 60_000;
const TIMEOUT_MS = 2_000;
const TENANT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@+|=~-]{0,255}$/;

const cache = new Map<string, { at: number; value: ContentMode }>();

export interface SettingsEnv {
  PRIMARY_SAAS_API_URL?: string;
  SAAS_SERVICE_TOKEN?: string;
}

export function clearWorkspaceContentCache(): void {
  cache.clear();
}

async function read(env: SettingsEnv, tenantId: string, doFetch: typeof fetch): Promise<ContentMode> {
  const base = (env.PRIMARY_SAAS_API_URL ?? "").trim().replace(/\/+$/, "");
  const token = (env.SAAS_SERVICE_TOKEN ?? "").trim();
  if (!base || !token || !TENANT_ID.test(tenantId)) return "metadata";
  try {
    const response = await doFetch(`${base}${SETTINGS_PATH}`, {
      method: "GET",
      headers: { accept: "application/json", authorization: `Bearer ${token}`, "x-tenant-id": tenantId },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return "metadata";
    const body = (await response.json()) as { content?: unknown };
    return body?.content === "redacted" ? "redacted" : "metadata";
  } catch {
    return "metadata";
  }
}

/** The workspace's content mode, cached 60 s. Never throws. */
export async function workspaceContentMode(env: SettingsEnv, tenantId: string, options: { fetch?: typeof fetch; now?: () => number } = {}): Promise<ContentMode> {
  const now = (options.now ?? Date.now)();
  const hit = cache.get(tenantId);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  const value = await read(env, tenantId, options.fetch ?? fetch);
  cache.set(tenantId, { at: now, value });
  if (cache.size > 2_000) cache.delete(cache.keys().next().value as string);
  return value;
}

/** The mode a workspace's traces export with: the global mode, lowered to `metadata` by the workspace setting. */
export async function effectiveContentMode(global: ContentMode, workspace: () => Promise<ContentMode>): Promise<ContentMode> {
  if (global === "metadata") return "metadata";
  try {
    return (await workspace()) === "redacted" ? "redacted" : "metadata";
  } catch {
    return "metadata";
  }
}
