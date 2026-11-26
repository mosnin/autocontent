import { z } from "zod";
import type { KeyValueStore, SqlStore } from "../storage/ports.ts";
import { AgentError } from "../errors.ts";
import { TENANT_ID_PATTERN, TenantIdSchema } from "../tenancy/tenancy.ts";
import { randomId } from "../util/crypto.ts";

/** Normalized event that every ingestion path (webhook, queue, schedule, app event) produces. */
export const EventEnvelopeSchema = z.object({
  id: z.string().min(1).max(200),
  tenantId: TenantIdSchema,
  source: z.string().min(1).max(80),
  type: z.string().min(1).max(120),
  /** Groups events that belong to the same agent conversation (user id, ticket id, account id...). */
  sessionKey: z.string().min(1).max(200),
  receivedAt: z.number(),
  payload: z.unknown(),
  signatureVerified: z.boolean(),
});
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

export function createEnvelope(input: Omit<EventEnvelope, "id" | "receivedAt"> & { id?: string; receivedAt?: number }): EventEnvelope {
  return EventEnvelopeSchema.parse({ ...input, id: input.id ?? randomId("evt"), receivedAt: input.receivedAt ?? Date.now() });
}

// ---------------------------------------------------------------------------
// Synchronous SHA-256 over WTF-8 (instance ids are built synchronously, and
// attacker-influenced session keys need a collision-resistant digest).
// ---------------------------------------------------------------------------

/**
 * WTF-8 bytes of a JS string: UTF-8 for well-formed text, plus the 3-byte
 * `ED A0..BF xx` form for lone surrogates (which never occurs in valid UTF-8).
 * Unlike `TextEncoder` (which maps every lone surrogate to U+FFFD) this is
 * injective over all JS strings.
 */
function wtf8Bytes(value: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < value.length; i++) {
    let cp = value.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return out;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Synchronous SHA-256 (hex) of a string's WTF-8 bytes. Equals `sha256Hex` for well-formed strings. */
export function sha256HexSync(value: string): string {
  const bytes = wtf8Bytes(value);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let shift = 56; shift >= 0; shift -= 8) bytes.push(shift >= 32 ? Math.floor(bitLength / 2 ** shift) & 0xff : (bitLength >>> shift) & 0xff);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = ((bytes[offset + i * 4] as number) << 24) | ((bytes[offset + i * 4 + 1] as number) << 16) | ((bytes[offset + i * 4 + 2] as number) << 8) | (bytes[offset + i * 4 + 3] as number);
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15] as number;
      const w2 = w[i - 2] as number;
      w[i] = ((w[i - 16] as number) + (rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3)) + (w[i - 7] as number) + (rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + (SHA256_K[i] as number) + (w[i] as number)) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = ((h[0] as number) + a) >>> 0;
    h[1] = ((h[1] as number) + b) >>> 0;
    h[2] = ((h[2] as number) + c) >>> 0;
    h[3] = ((h[3] as number) + d) >>> 0;
    h[4] = ((h[4] as number) + e) >>> 0;
    h[5] = ((h[5] as number) + f) >>> 0;
    h[6] = ((h[6] as number) + g) >>> 0;
    h[7] = ((h[7] as number) + hh) >>> 0;
  }
  return [...h].map((x) => x.toString(16).padStart(8, "0")).join("");
}

const SAFE_SESSION_KEY = /^[A-Za-z0-9_.:-]{1,160}$/;
const HASHED_SESSION_KEY = /:h[0-9a-f]{32}$/;

/**
 * Injective session-key segment for instance ids. Keys of at most 160 chars of
 * `[A-Za-z0-9_.:-]` are kept verbatim; anything else (other characters, longer
 * keys, or keys that already look hashed) becomes `<readable prefix>:h<128-bit
 * SHA-256>`, so two different keys never share an instance (no lossy `_`
 * replacement, no truncation).
 */
export function instanceSessionKey(sessionKey: string): string {
  if (SAFE_SESSION_KEY.test(sessionKey) && !HASHED_SESSION_KEY.test(sessionKey)) return sessionKey;
  const prefix = sessionKey.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 64);
  return `${prefix}:h${sha256HexSync(sessionKey).slice(0, 32)}`;
}

const cleanAgentName = (agent: string) => agent.replace(/[^A-Za-z0-9_.:-]/g, "_").replace(/-{2,}/g, "-");

/**
 * Deterministic agent instance id for an event: the same tenant + session always
 * maps to the same Durable Object (idFromName / Flue conversation id).
 * For user-owned chat conversations use `conversationInstanceId` instead: it
 * encodes the user id so ownership checks stay exact; for harness-owned
 * sessions (delegation, rooms, jobs, bus) pass `harnessSessionKey(kind, key)`.
 * The tenant id must be valid (never truncated or rewritten) and the session
 * key goes through `instanceSessionKey` (injective).
 */
export function agentInstanceId(agent: string, tenantId: string, sessionKey: string): string {
  if (!TENANT_ID_PATTERN.test(tenantId)) throw new AgentError("TENANT_ISOLATION_VIOLATION", "Invalid or malformed tenant id.");
  return `${cleanAgentName(agent)}--${tenantId}--${instanceSessionKey(sessionKey)}`;
}

/** Kinds of harness-owned sessions (never addressable as a user's conversation). */
export type HarnessSessionKind = "dlg" | "room" | "job" | "bus" | "agent";

const HARNESS_PREFIX = "-";

/**
 * Session key for a harness-owned instance (delegation worker, room
 * specialist, background job, bus target): `-<kind>.<key>`. The leading `-`
 * is outside the `encodeIdSegment` alphabet, so `parseConversationInstanceId`
 * rejects the id and `isConversationOwner` can never match it for any user,
 * whatever their `sub` (a user named "dlg" or "room" included). The key part
 * goes through `instanceSessionKey`, so it is injective and bounded.
 */
export function harnessSessionKey(kind: HarnessSessionKind, key: string): string {
  if (!["dlg", "room", "job", "bus", "agent"].includes(kind)) throw new AgentError("CONFIG_INVALID", `Unknown harness session kind "${kind}"`);
  return `${HARNESS_PREFIX}${kind}.${instanceSessionKey(key)}`;
}

/**
 * Instance id of a persistent agent's Flue conversation: `persistent-agent--<tenantId>---agent.<agentId>`. It is a
 * harness session (kind `agent`), so no user can own, read or post to it (R-MA-17); only the control plane
 * dispatches into it.
 */
export function persistentAgentInstanceId(tenantId: string, agentId: string, agentName = "persistent-agent"): string {
  return agentInstanceId(agentName, tenantId, harnessSessionKey("agent", agentId));
}

/** The harness kind of a session key minted by `harnessSessionKey`, or null for any other key. */
export function parseHarnessSessionKey(sessionKey: string): { kind: HarnessSessionKind; key: string } | null {
  const match = /^-(dlg|room|job|bus|agent)\.(.+)$/.exec(sessionKey);
  return match ? { kind: match[1] as HarnessSessionKind, key: match[2] as string } : null;
}

/**
 * Split `${agent}--${tenantId}--${sessionKey}` on its first two separators.
 * Agent names and tenant ids can never contain `--` (see `TENANT_ID_PATTERN`),
 * so the session key may; a tenant segment that is not a valid tenant id
 * makes the whole id invalid (fail closed).
 */
export function parseAgentInstanceId(id: string): { agent: string; tenantId: string; sessionKey: string } | null {
  const first = id.indexOf("--");
  if (first <= 0) return null;
  const second = id.indexOf("--", first + 2);
  if (second === -1) return null;
  const agent = id.slice(0, first);
  const tenantId = id.slice(first + 2, second);
  const sessionKey = id.slice(second + 2);
  if (!sessionKey || !TENANT_ID_PATTERN.test(tenantId)) return null;
  return { agent, tenantId, sessionKey };
}

const ID_SAFE_BYTE = /^[A-Za-z0-9_]$/;

/**
 * Injective, reversible encoding of an arbitrary identity string (user id,
 * email, IdP subject such as `auth0|abc`) into `[A-Za-z0-9_:]`: every other
 * UTF-8 byte becomes `:XX` (upper-case hex). Lone surrogates use their WTF-8
 * bytes, so the encoding stays injective over every JS string. The output never contains `.` or
 * `-`, so it can neither forge the `--` segment separator nor the `.`
 * owner/session separator of conversation ids. Compare ENCODED values for
 * authorization (`encodeIdSegment(claims.sub) === owner`); never decode for it.
 */
export function encodeIdSegment(value: string): string {
  let out = "";
  // WTF-8, not TextEncoder: lone surrogates get their own byte form instead of collapsing onto U+FFFD.
  for (const byte of wtf8Bytes(value)) {
    const ch = String.fromCharCode(byte);
    out += byte < 0x80 && ID_SAFE_BYTE.test(ch) ? ch : `:${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/** Inverse of `encodeIdSegment` (display only). Throws `CONFIG_INVALID` on malformed input. */
export function decodeIdSegment(encoded: string): string {
  if (!/^(?:[A-Za-z0-9_]|:[0-9A-F]{2})*$/.test(encoded)) throw new AgentError("CONFIG_INVALID", "Malformed encoded id segment");
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; ) {
    if (encoded[i] === ":") {
      bytes.push(Number.parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 3;
    } else {
      bytes.push(encoded.charCodeAt(i));
      i += 1;
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(new Uint8Array(bytes));
  } catch (error) {
    throw new AgentError("CONFIG_INVALID", "Encoded id segment is not valid UTF-8", { cause: error });
  }
}

/** Client-chosen conversation keys: `[A-Za-z0-9_.:-]`, no `--`, at most 60 chars (defaults to "main"). */
export function sanitizeSessionKey(sessionKey: string): string {
  return sessionKey.replace(/[^A-Za-z0-9_.:-]/g, "_").replace(/-{2,}/g, "-").slice(0, 60) || "main";
}

/**
 * The one way to mint a user-owned conversation id:
 * `${agent}--${tenantId}--${encodeIdSegment(userId)}.${sessionKey}`. The owner
 * segment is never truncated, so ownership is exact for any `sub` (emails,
 * `auth0|…`, ids containing `.` or `--`).
 */
export function conversationInstanceId(agent: string, tenantId: string, userId: string, sessionKey: string): string {
  if (!TENANT_ID_PATTERN.test(tenantId)) throw new AgentError("TENANT_ISOLATION_VIOLATION", "Invalid or malformed tenant id.");
  if (!userId) throw new AgentError("TENANT_ISOLATION_VIOLATION", "A conversation needs an owning user id.");
  return `${agent.replace(/[^A-Za-z0-9_.:-]/g, "_").replace(/-{2,}/g, "-")}--${tenantId}--${encodeIdSegment(userId)}.${sanitizeSessionKey(sessionKey)}`;
}

/** Parsed user-owned conversation id: `owner` is the ENCODED user id, `userId` its decoded form (null if malformed). */
export function parseConversationInstanceId(id: string): { agent: string; tenantId: string; owner: string; userId: string | null; sessionKey: string } | null {
  const parsed = parseAgentInstanceId(id);
  if (!parsed) return null;
  const dot = parsed.sessionKey.indexOf(".");
  if (dot <= 0) return null;
  const owner = parsed.sessionKey.slice(0, dot);
  if (!/^(?:[A-Za-z0-9_]|:[0-9A-F]{2})+$/.test(owner)) return null;
  let userId: string | null;
  try {
    userId = decodeIdSegment(owner);
  } catch {
    userId = null;
  }
  return { agent: parsed.agent, tenantId: parsed.tenantId, owner, userId, sessionKey: parsed.sessionKey.slice(dot + 1) };
}

/** Exact ownership check for a conversation id (same tenant, same encoded user). */
export function isConversationOwner(id: string, claims: { tid: string; sub: string }): boolean {
  const parsed = parseConversationInstanceId(id);
  return parsed !== null && parsed.tenantId === claims.tid && parsed.owner === encodeIdSegment(claims.sub);
}

export interface CoalescedTurn {
  tenantId: string;
  sessionKey: string;
  eventIds: string[];
  types: string[];
  firstReceivedAt: number;
  lastReceivedAt: number;
  events: EventEnvelope[];
}

/**
 * Batch rapid-fire events into single agent turns: five chat messages in ten
 * seconds become one turn. Groups by tenant + session, de-duplicates by event id,
 * preserves chronological order.
 */
export function coalesceEvents(events: EventEnvelope[], options: { maxEventsPerTurn?: number } = {}): CoalescedTurn[] {
  const max = options.maxEventsPerTurn ?? 25;
  const groups = new Map<string, EventEnvelope[]>();
  const seen = new Set<string>();
  for (const event of [...events].sort((a, b) => a.receivedAt - b.receivedAt)) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    const key = `${event.tenantId}\u0000${event.sessionKey}`;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  const turns: CoalescedTurn[] = [];
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i += max) {
      const slice = group.slice(i, i + max);
      const first = slice[0] as EventEnvelope;
      const last = slice[slice.length - 1] as EventEnvelope;
      turns.push({
        tenantId: first.tenantId,
        sessionKey: first.sessionKey,
        eventIds: slice.map((e) => e.id),
        types: [...new Set(slice.map((e) => e.type))],
        firstReceivedAt: first.receivedAt,
        lastReceivedAt: last.receivedAt,
        events: slice,
      });
    }
  }
  return turns;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Token-bucket limiter per tenant (or any key). State lives in KV (or a DO) so it
 * holds across isolates; precision is "good enough" for cost protection, not
 * billing. Use a Durable Object counter for strict global limits.
 */
export class TokenBucketRateLimiter {
  constructor(
    private readonly store: KeyValueStore,
    private readonly options: { ratePerMinute: number; burst: number; clock?: () => number; prefix?: string },
  ) {}

  async take(key: string, cost = 1, override?: { ratePerMinute: number; burst: number }): Promise<RateLimitDecision> {
    const rate = override?.ratePerMinute ?? this.options.ratePerMinute;
    const burst = override?.burst ?? this.options.burst;
    const now = (this.options.clock ?? Date.now)();
    const storageKey = `${this.options.prefix ?? "rl:"}${key}`;
    const raw = await this.store.get(storageKey);
    const state = raw ? (JSON.parse(raw) as { tokens: number; updatedAt: number }) : { tokens: burst, updatedAt: now };
    const refill = ((now - state.updatedAt) / 60_000) * rate;
    const tokens = Math.min(burst, state.tokens + refill);
    if (tokens < cost) {
      await this.store.put(storageKey, JSON.stringify({ tokens, updatedAt: now }), { expirationTtlSeconds: 3600 });
      return { allowed: false, remaining: Math.floor(tokens), retryAfterMs: Math.ceil(((cost - tokens) / rate) * 60_000) };
    }
    await this.store.put(storageKey, JSON.stringify({ tokens: tokens - cost, updatedAt: now }), { expirationTtlSeconds: 3600 });
    return { allowed: true, remaining: Math.floor(tokens - cost), retryAfterMs: 0 };
  }
}

/**
 * Durable inbox: events that arrive while a run is mid-reasoning are queued in
 * SQLite and drained in order at the next turn boundary (sequential fiber
 * queuing). Duplicate event ids are ignored.
 */
export class Inbox {
  constructor(
    private readonly sql: SqlStore,
    private readonly runKey: string,
  ) {}

  enqueue(event: EventEnvelope): boolean {
    const before = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM as_inbox WHERE event_id = ?`, event.id)[0]?.n ?? 0;
    if (Number(before) > 0) return false;
    this.sql.exec(`INSERT INTO as_inbox (run_key, event_id, payload, received_at) VALUES (?, ?, ?, ?)`, this.runKey, event.id, JSON.stringify(event), event.receivedAt);
    return true;
  }

  peek(limit = 25): EventEnvelope[] {
    return this.sql
      .exec<{ payload: string }>(`SELECT payload FROM as_inbox WHERE run_key = ? AND status = 'PENDING' ORDER BY received_at, id LIMIT ?`, this.runKey, limit)
      .map((r) => JSON.parse(r.payload) as EventEnvelope);
  }

  ack(eventIds: string[]): void {
    for (const id of eventIds) this.sql.exec(`UPDATE as_inbox SET status = 'DONE' WHERE event_id = ?`, id);
  }

  pendingCount(): number {
    return Number(this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM as_inbox WHERE run_key = ? AND status = 'PENDING'`, this.runKey)[0]?.n ?? 0);
  }
}
