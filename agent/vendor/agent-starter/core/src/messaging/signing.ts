import { AgentError } from "../errors.ts";
import type { KeyValueStore } from "../storage/ports.ts";
import { hmacSha256Hex, sha256Hex, timingSafeEqual } from "../util/crypto.ts";

export const SIGNATURE_HEADER = "x-agent-signature";
export const TIMESTAMP_HEADER = "x-agent-timestamp";

/**
 * Sign an outbound webhook body. The signature covers `${timestamp}.${body}`
 * so captured requests cannot be replayed outside the tolerance window.
 */
export async function signPayload(secret: string, body: string, timestampSeconds = Math.floor(Date.now() / 1000)): Promise<{ signature: string; timestamp: string; header: string }> {
  const timestamp = String(timestampSeconds);
  const signature = await hmacSha256Hex(secret, `${timestamp}.${body}`);
  return { signature, timestamp, header: `t=${timestamp},v1=${signature}` };
}

export interface VerifyOptions {
  toleranceSeconds?: number;
  now?: () => number;
}

/**
 * Verify a webhook produced by `signPayload` (or any HMAC-SHA256 `t=..,v1=..`
 * scheme). Constant-time comparison; supports secret rotation via an array.
 */
/**
 * Parse a `t=<unix seconds>,v1=<hex>[,v1=<hex>…]` header. The timestamp must be
 * a plain integer: `NaN` would make every window comparison false and
 * silently disable replay protection.
 */
export function parseSignatureHeader(header: string | null): { timestamp: number; signatures: string[] } {
  if (!header) throw new AgentError("SIGNATURE_INVALID", "Missing signature header");
  // Parse every entry: during secret rotation senders include several `v1` signatures.
  const entries = header.split(",").map((kv) => {
    const index = kv.indexOf("=");
    return index === -1 ? ["", ""] : [kv.slice(0, index).trim(), kv.slice(index + 1).trim()];
  });
  const timestamps = entries.filter(([k]) => k === "t").map(([, v]) => v as string);
  const signatures = entries.filter(([k, v]) => k === "v1" && v).map(([, v]) => v as string);
  if (timestamps.length !== 1 || signatures.length === 0) throw new AgentError("SIGNATURE_INVALID", "Malformed signature header");
  const raw = timestamps[0] as string;
  const timestamp = /^\d{1,12}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(timestamp)) throw new AgentError("SIGNATURE_INVALID", "Malformed signature timestamp");
  return { timestamp, signatures };
}

export async function verifySignature(secrets: string | string[], body: string, header: string | null, options: VerifyOptions = {}): Promise<void> {
  const { timestamp, signatures: provided } = parseSignatureHeader(header);
  const tolerance = options.toleranceSeconds ?? 300;
  const now = Math.floor((options.now ?? Date.now)() / 1000);
  if (!(Math.abs(now - timestamp) <= tolerance)) throw new AgentError("SIGNATURE_INVALID", "Signature timestamp outside tolerance window");
  for (const secret of Array.isArray(secrets) ? secrets : [secrets]) {
    if (!secret) continue;
    const expected = await hmacSha256Hex(secret, `${timestamp}.${body}`);
    if (provided.some((candidate) => timingSafeEqual(expected, candidate))) return;
  }
  throw new AgentError("SIGNATURE_INVALID", "Signature mismatch");
}

/** Verify a plain hex/base64 HMAC of the raw body (common for third-party webhooks: Manychat, Shopify, GitHub). */
export async function verifyRawHmac(secret: string, body: string, provided: string | null, options: { encoding?: "hex" | "base64"; prefix?: string } = {}): Promise<void> {
  if (!provided) throw new AgentError("SIGNATURE_INVALID", "Missing signature");
  const value = options.prefix && provided.startsWith(options.prefix) ? provided.slice(options.prefix.length) : provided;
  const hex = await hmacSha256Hex(secret, body);
  const expected = options.encoding === "base64" ? btoa(String.fromCharCode(...(hex.match(/../g) ?? []).map((h) => Number.parseInt(h, 16)))) : hex;
  if (!timingSafeEqual(expected, value)) throw new AgentError("SIGNATURE_INVALID", "Signature mismatch");
}

// ---------------------------------------------------------------------------
// Signed internal requests (SaaS → edge) with replay protection
// ---------------------------------------------------------------------------

/** Remembers request fingerprints for the replay window. `firstSeen` returns false for a replay. */
export interface ReplayGuard {
  firstSeen(key: string, ttlSeconds: number): Promise<boolean>;
}

/**
 * Replay cache over any KeyValueStore (Workers KV, memory). KV is eventually
 * consistent, so two copies racing within milliseconds may both pass; use a
 * Durable Object-backed guard when you need strict once-only semantics.
 */
export class KeyValueReplayGuard implements ReplayGuard {
  constructor(
    private readonly kv: KeyValueStore,
    private readonly prefix = "replay:",
  ) {}

  async firstSeen(key: string, ttlSeconds: number): Promise<boolean> {
    const storageKey = `${this.prefix}${key}`;
    if ((await this.kv.get(storageKey)) !== null) return false;
    await this.kv.put(storageKey, "1", { expirationTtlSeconds: Math.max(60, Math.ceil(ttlSeconds)) });
    return true;
  }
}

/** The string a signed request covers: method, path and body, so a signature for one route/tenant/verb never validates another. */
export function canonicalRequest(method: string, path: string, body: string): string {
  return `${method.toUpperCase()}\n${path}\n${body}`;
}

/** Sign an internal request (e.g. the SaaS pushing tenant config): header goes in `x-agent-signature`. */
export async function signRequest(secret: string, request: { method: string; path: string; body?: string }, timestampSeconds?: number) {
  return signPayload(secret, canonicalRequest(request.method, request.path, request.body ?? ""), timestampSeconds);
}

/**
 * Verify a request signed with `signRequest`: HMAC over method + path + body,
 * timestamp window, secret rotation, and (with `replay`) single use within the
 * window. The replay key is derived from the signed content itself, so
 * re-ordering or padding the header cannot dodge the cache.
 */
export async function verifySignedRequest(
  secrets: string | string[],
  request: { method: string; path: string; body: string; header: string | null },
  options: VerifyOptions & { replay?: ReplayGuard; replayScope?: string } = {},
): Promise<{ timestamp: number }> {
  const canonical = canonicalRequest(request.method, request.path, request.body);
  await verifySignature(secrets, canonical, request.header, options);
  const { timestamp } = parseSignatureHeader(request.header);
  if (options.replay) {
    const key = `${options.replayScope ?? "req"}:${await sha256Hex(`${timestamp}.${canonical}`)}`;
    if (!(await options.replay.firstSeen(key, (options.toleranceSeconds ?? 300) + 60))) {
      throw new AgentError("SIGNATURE_INVALID", "Replayed signed request", { details: { replay: true } });
    }
  }
  return { timestamp };
}
