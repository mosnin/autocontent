import { z } from "zod";
import { AgentError } from "../errors.ts";
import { base64UrlDecode, base64UrlEncode, hmacSha256, timingSafeEqual } from "../util/crypto.ts";
import { TenantIdSchema } from "./tenancy.ts";

/** Role carried by anonymous widget visitors (chat widget and voice widget). */
export const VISITOR_ROLE = "visitor";
/** Audience of anonymous widget visitor tokens: accepted only by routes that opt in (`allowVisitors`). */
export const WIDGET_AUDIENCE = "widget";
/** Audience of the voice agent's Flue token: bound to one conversation (`cid`), accepted only by `agentAuth`. */
export const VOICE_AUDIENCE = "voice";

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** True when `value` is well-formed UTF-16 (no lone surrogates). Identity strings must be. */
export function isWellFormedIdentity(value: string): boolean {
  return !LONE_SURROGATE.test(value);
}

export const SessionClaimsSchema = z.object({
  /** User id. Must be well-formed UTF-16 (lone surrogates would make owner encodings ambiguous). */
  sub: z.string().min(1).refine(isWellFormedIdentity, { message: "Subject must be well-formed UTF-16." }),
  /** Tenant id. */
  tid: TenantIdSchema,
  roles: z.array(z.string()).default([]),
  scopes: z.array(z.string()).default([]),
  /** Expiry, epoch seconds. */
  exp: z.number().int(),
  /** Issued at, epoch seconds. */
  iat: z.number().int(),
  env: z.enum(["production", "staging", "development", "test"]).default("production"),
  /**
   * Restricted audience. Absent on the host SaaS's normal user tokens (accepted everywhere).
   * `widget` (anonymous visitors) and `voice` (the voice agent's conversation-bound token) are
   * rejected by `verifySessionToken` unless the caller lists the audience in `audiences`.
   */
  aud: z
    .string()
    .regex(/^[a-z][a-z0-9:_-]{0,63}$/)
    .optional(),
  /** Bound conversation id: a token with `cid` may only address that one conversation. */
  cid: z.string().min(1).max(512).optional(),
});
export type SessionClaims = z.infer<typeof SessionClaimsSchema>;

export interface VerifySessionOptions {
  now?: () => number;
  /**
   * Restricted audiences this route accepts (`[WIDGET_AUDIENCE]`, `[VOICE_AUDIENCE]`). Default: none, so
   * visitor and voice tokens fail closed on every route that did not opt in.
   */
  audiences?: readonly string[];
}

/**
 * Effective audience of a token: its `aud` claim, or `widget` for any token carrying the
 * `visitor` role (a visitor is never a full user, even if a host minted it without `aud`).
 */
export function sessionAudience(claims: Pick<SessionClaims, "roles"> & { aud?: string | undefined }): string | undefined {
  return claims.aud ?? (claims.roles.includes(VISITOR_ROLE) ? WIDGET_AUDIENCE : undefined);
}

/** True for anonymous widget visitors (role `visitor` or audience `widget`). */
export function isVisitorClaims(claims: Pick<SessionClaims, "roles"> & { aud?: string | undefined }): boolean {
  return claims.roles.includes(VISITOR_ROLE) || claims.aud === WIDGET_AUDIENCE;
}

/**
 * Compact HS256-style session token (header-less JWT shape: `payload.signature`)
 * that the host SaaS mints for its signed-in user so the agent backend can
 * authenticate browser calls and derive the tenant server-side.
 */
export async function createSessionToken(secret: string, claims: Omit<SessionClaims, "iat" | "exp" | "roles" | "scopes" | "env"> & Partial<Pick<SessionClaims, "roles" | "scopes" | "env">>, ttlSeconds = 3600): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = SessionClaimsSchema.parse({ ...claims, iat: now, exp: now + ttlSeconds });
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${body}.${base64UrlEncode(await hmacSha256(secret, body))}`;
}

/**
 * Verify a session token: signature (any of the rotation secrets), claims, expiry and audience.
 * Tokens with a restricted audience (`aud`, or the `visitor` role) are rejected unless the
 * audience is listed in `options.audiences`. The third argument may also be a bare clock
 * function (legacy signature).
 */
export async function verifySessionToken(secret: string | string[], token: string | null | undefined, options: (() => number) | VerifySessionOptions = {}): Promise<SessionClaims> {
  const opts: VerifySessionOptions = typeof options === "function" ? { now: options } : options;
  if (!token) throw new AgentError("SIGNATURE_INVALID", "Missing session token");
  const [body, signature, extra] = token.replace(/^Bearer\s+/i, "").split(".");
  if (!body || !signature || extra !== undefined) throw new AgentError("SIGNATURE_INVALID", "Malformed session token");
  let valid = false;
  for (const s of Array.isArray(secret) ? secret : [secret]) {
    if (s && timingSafeEqual(base64UrlEncode(await hmacSha256(s, body)), signature)) valid = true;
  }
  if (!valid) throw new AgentError("SIGNATURE_INVALID", "Session token signature mismatch");
  let decoded: unknown;
  try {
    decoded = JSON.parse(base64UrlDecode(body));
  } catch (error) {
    throw new AgentError("SIGNATURE_INVALID", "Session token payload unreadable", { cause: error });
  }
  const claims = SessionClaimsSchema.safeParse(decoded);
  if (!claims.success) throw new AgentError("SIGNATURE_INVALID", "Session token claims invalid");
  if (claims.data.exp * 1000 < (opts.now ?? Date.now)()) throw new AgentError("SIGNATURE_INVALID", "Session token expired");
  const audience = sessionAudience(claims.data);
  if (audience !== undefined && !(opts.audiences ?? []).includes(audience)) {
    throw new AgentError("SIGNATURE_INVALID", `Session token audience "${audience}" is not accepted here`, { details: { audience } });
  }
  return claims.data;
}

// ---------------------------------------------------------------------------
// Anonymous widget visitors
// ---------------------------------------------------------------------------

const VISITOR_ID = /^[A-Za-z0-9_-]{16,64}$/;

function newVisitorId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const visitorMac = async (secret: string, tenantId: string, visitorId: string) => base64UrlEncode(await hmacSha256(secret, `as-visitor:v1:${tenantId}:${visitorId}`));

/**
 * Visitor credential: `<visitorId>.<HMAC(secret, tenant:visitorId)>`. The widget stores it and
 * presents it to resume the same anonymous identity; a bare visitor id proves nothing, so
 * `resolveVisitor` mints a fresh random identity whenever the credential is missing or invalid.
 */
export async function createVisitorCredential(secret: string, tenantId: string, visitorId: string = newVisitorId()): Promise<{ visitorId: string; credential: string }> {
  if (!VISITOR_ID.test(visitorId)) throw new AgentError("CONFIG_INVALID", "Visitor ids are 16-64 chars of [A-Za-z0-9_-]");
  return { visitorId, credential: `${visitorId}.${await visitorMac(secret, tenantId, visitorId)}` };
}

/** The visitor id a credential proves for this tenant, or null (wrong tenant, forged, malformed). */
export async function verifyVisitorCredential(secrets: string | string[], tenantId: string, credential: string | null | undefined): Promise<string | null> {
  if (!credential || credential.length > 200) return null;
  const dot = credential.indexOf(".");
  const visitorId = credential.slice(0, dot);
  const mac = credential.slice(dot + 1);
  if (dot <= 0 || !VISITOR_ID.test(visitorId) || !mac) return null;
  for (const secret of Array.isArray(secrets) ? secrets : [secrets]) {
    if (secret && timingSafeEqual(await visitorMac(secret, tenantId, visitorId), mac)) return visitorId;
  }
  return null;
}

/**
 * Resume the visitor a valid credential proves, or mint a fresh one. Always returns a credential
 * signed with the CURRENT secret (`secrets[0]`), so rotation re-signs returning visitors.
 */
export async function resolveVisitor(secrets: string | string[], tenantId: string, credential: string | null | undefined): Promise<{ visitorId: string; credential: string; resumed: boolean }> {
  const list = (Array.isArray(secrets) ? secrets : [secrets]).filter(Boolean);
  const current = list[0];
  if (!current) throw new AgentError("CONFIG_INVALID", "A visitor signing secret is required");
  const proven = await verifyVisitorCredential(list, tenantId, credential);
  const minted = await createVisitorCredential(current, tenantId, proven ?? undefined);
  return { ...minted, resumed: proven !== null };
}

/** Claims of an anonymous widget visitor: role `visitor`, audience `widget`, no scopes. */
export function visitorClaims(tenantId: string, visitorId: string): { sub: string; tid: string; roles: string[]; scopes: string[]; aud: string } {
  return { sub: `visitor_${visitorId}`, tid: tenantId, roles: [VISITOR_ROLE], scopes: [], aud: WIDGET_AUDIENCE };
}

/** Mint a short-lived widget visitor session token (role `visitor`, audience `widget`). */
export function createVisitorSessionToken(secret: string, tenantId: string, visitorId: string, ttlSeconds = 2 * 3600): Promise<string> {
  return createSessionToken(secret, visitorClaims(tenantId, visitorId), ttlSeconds);
}
