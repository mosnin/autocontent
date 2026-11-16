import { type BlobStore, hmacSha256Hex, safeRelativeKey, TENANT_ID_PATTERN, timingSafeEqual } from "@agent-starter/core";
import { Hono } from "hono";

/**
 * Signed, expiring download links for tenant artifacts (reports, logs, exports saved with `save_artifact`),
 * R-EVT-11. The workspace bucket stays private: a link names one object under
 * `tenants/<tenantId>/artifacts/` and carries `exp` + an HMAC over (tenant, path, exp), so it cannot be
 * re-pointed at another tenant, another object or anything outside `artifacts/` (workspaces, shadow diffs,
 * snapshots), and it stops working when it expires. `notify_saas` puts the link in the job result webhook.
 *
 *   GET /artifacts/:tenantId/<path under artifacts/>?exp=<unix seconds>&sig=<hex>
 *
 * Pure module (no bindings): platform.ts supplies the secret and the bucket.
 */
export const ARTIFACT_LINK_TTL_SECONDS = 7 * 86_400;
const MAX_LINK_TTL_SECONDS = 30 * 86_400;
const ARTIFACT_KEY = /^tenants\/([^/]+)\/artifacts\/(.+)$/;

/** `tenants/<tenant>/artifacts/<path>` → its tenant and path, or null for any other key. */
export function parseArtifactKey(key: string): { tenantId: string; path: string } | null {
  const match = ARTIFACT_KEY.exec(key);
  if (!match) return null;
  const tenantId = match[1] as string;
  if (!TENANT_ID_PATTERN.test(tenantId)) return null;
  try {
    return { tenantId, path: safeRelativeKey(match[2] as string) };
  } catch {
    return null;
  }
}

const message = (tenantId: string, path: string, exp: number) => `artifact\n${tenantId}\n${path}\n${exp}`;

/**
 * Signed link for an artifact key of `tenantId`. Null when the key is not one of that tenant's artifacts
 * (a model-supplied key naming another tenant or a non-artifact object never gets a link).
 */
export async function signArtifactUrl(input: { baseUrl: string; secret: string; tenantId: string; key: string; ttlSeconds?: number; now?: number }): Promise<string | null> {
  const parsed = parseArtifactKey(input.key);
  if (!parsed || parsed.tenantId !== input.tenantId || !input.secret) return null;
  const ttl = Math.min(MAX_LINK_TTL_SECONDS, Math.max(60, Math.floor(input.ttlSeconds ?? ARTIFACT_LINK_TTL_SECONDS)));
  const exp = Math.floor((input.now ?? Date.now()) / 1000) + ttl;
  const sig = await hmacSha256Hex(input.secret, message(parsed.tenantId, parsed.path, exp));
  const path = parsed.path.split("/").map(encodeURIComponent).join("/");
  return `${input.baseUrl.replace(/\/+$/, "")}/artifacts/${encodeURIComponent(parsed.tenantId)}/${path}?exp=${exp}&sig=${sig}`;
}

/** Valid, unexpired signature for (tenant, path, exp) under any of the secrets (rotation). */
export async function verifyArtifactLink(secrets: readonly string[], input: { tenantId: string; path: string; exp: number; sig: string; now?: number }): Promise<boolean> {
  if (!Number.isInteger(input.exp) || input.exp < Math.floor((input.now ?? Date.now()) / 1000) || !/^[0-9a-f]{64}$/.test(input.sig)) return false;
  for (const secret of secrets) {
    if (secret && timingSafeEqual(await hmacSha256Hex(secret, message(input.tenantId, input.path, input.exp)), input.sig)) return true;
  }
  return false;
}

/** The download route. 403 for a bad or expired link (no detail), 404 when the object is gone. */
export function createArtifactRoutes<E extends object>(options: { secrets: (env: E) => string[]; blobs: (env: E) => BlobStore }) {
  return new Hono<{ Bindings: E }>().get("/artifacts/:tenantId/*", async (c) => {
    const tenantId = c.req.param("tenantId");
    // ["", "artifacts", "<tenant>", ...path segments] (raw, still percent-encoded).
    const segments = c.req.path.split("/").slice(3);
    let path: string;
    try {
      path = safeRelativeKey(segments.map(decodeURIComponent).join("/"));
    } catch {
      return c.json({ error: "FORBIDDEN" }, 403);
    }
    if (!TENANT_ID_PATTERN.test(tenantId) || !path) return c.json({ error: "FORBIDDEN" }, 403);
    const ok = await verifyArtifactLink(options.secrets(c.env), { tenantId, path, exp: Number(c.req.query("exp")), sig: c.req.query("sig") ?? "" });
    if (!ok) return c.json({ error: "FORBIDDEN" }, 403);
    const object = await options.blobs(c.env).get(`tenants/${tenantId}/artifacts/${path}`);
    if (!object) return c.json({ error: "NOT_FOUND" }, 404);
    return new Response(await object.arrayBuffer(), {
      headers: {
        "content-type": object.contentType ?? "application/octet-stream",
        "content-disposition": `attachment; filename="${(path.split("/").pop() ?? "artifact").replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });
}
