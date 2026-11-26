import {
  type AgentMessage,
  AgentMessageSchema,
  coalesceEvents,
  type CoalescedTurn,
  createEnvelope,
  type EventEnvelope,
  EventEnvelopeSchema,
  type KeyValueStore,
  type MessageBus,
  sha256Hex,
  type TokenBucketRateLimiter,
  validateDeliverable,
  verifySignedRequest,
  wrapUntrusted,
} from "@agent-starter/core";
import type { z } from "zod";

/** Structural Queue producer (works with `env.MY_QUEUE`). */
export interface QueueProducer<T> {
  send(body: T, options?: { contentType?: "json" | "text" | "bytes" | "v8"; delaySeconds?: number }): Promise<unknown>;
  sendBatch?(messages: Iterable<{ body: T; delaySeconds?: number }>): Promise<unknown>;
}

/**
 * What a verifier proved. `nonce` is derived from signed material only (replay key);
 * `pathSigned` means the URL path (and so the tenant and source in it) was covered by the signature.
 */
export interface VerifiedDelivery {
  nonce?: string;
  pathSigned?: boolean;
}

export interface SignedDeliveryOptions {
  /** Header carrying `t=…,v1=…` (default `x-agent-signature`). */
  header?: string;
  /** Timestamp tolerance in seconds (default 300). */
  toleranceSeconds?: number;
  /** Path the sender signed (default: the request URL's pathname). */
  path?: (request: Request) => string;
}

/**
 * Verifier for `createIngestionHandler` that checks a `signRequest(secret, { method, path, body })`
 * signature: method + path + body are covered, so a captured delivery for `/events/chat/tenant-a`
 * cannot be replayed to another tenant, source or verb. Secrets may depend on the request (per-tenant
 * secrets, read from the path before verifying); rotation via arrays. The returned nonce is the
 * SHA-256 of the signed canonical request plus its timestamp (signed data only).
 */
export function signedDeliveryVerifier(secrets: string | string[] | ((request: Request) => string | string[] | Promise<string | string[]>), options: SignedDeliveryOptions = {}): (rawBody: string, request: Request) => Promise<VerifiedDelivery> {
  return async (rawBody, request) => {
    const resolved = typeof secrets === "function" ? await secrets(request) : secrets;
    const path = options.path?.(request) ?? new URL(request.url).pathname;
    const header = request.headers.get(options.header ?? "x-agent-signature");
    const { timestamp } = await verifySignedRequest(resolved, { method: request.method, path, body: rawBody, header }, { ...(options.toleranceSeconds !== undefined ? { toleranceSeconds: options.toleranceSeconds } : {}) });
    return { nonce: `req:${await sha256Hex(`${timestamp}\n${request.method.toUpperCase()}\n${path}\n${rawBody}`)}`, pathSigned: true };
  };
}

export interface IngestionOptions<S extends z.ZodType> {
  source: string;
  /** zod schema for the provider payload (sanitizes untrusted fields). */
  schema: S;
  /**
   * Verify the provider signature against the RAW body. Throw to reject (401). Return a
   * `VerifiedDelivery` when the signature also covers the path (`signedDeliveryVerifier`) or yields a
   * signed nonce; a plain `void` means only the body is signed, so nothing from the URL or unsigned
   * headers (tenant, source, request ids) is used for replay protection or event ids.
   */
  verify: (rawBody: string, request: Request) => Promise<void | VerifiedDelivery>;
  /** Resolve the tenant for this webhook (from a verified header, path param or payload — never trust unverified input). */
  tenantId: (payload: z.infer<S>, request: Request) => string | Promise<string>;
  /** Group events into agent sessions (user id, ticket id, account id...). */
  sessionKey: (payload: z.infer<S>) => string;
  eventType: (payload: z.infer<S>) => string;
  /** Stable provider event id for de-duplication (defaults to a random id). */
  eventId?: (payload: z.infer<S>) => string | undefined;
  queue: QueueProducer<EventEnvelope>;
  rateLimiter?: TokenBucketRateLimiter;
  maxBodyBytes?: number;
  /**
   * Webhook nonce cache (replay / duplicate-delivery protection at the edge).
   * A delivery whose nonce was already accepted inside the TTL is answered
   * `200 { accepted: false, duplicate: true }` and NOT enqueued again. The
   * nonce is recorded only after a successful enqueue, so a failed attempt can
   * be retried by the provider.
   */
  nonceCache?: {
    store: KeyValueStore;
    /** Seconds to remember a nonce. Default 900 (3× the 300 s signature window). */
    ttlSeconds?: number;
    /**
     * Nonce for a delivery. Default, from signed data only: the verifier's nonce when it returns one;
     * else `${source}:${tenant}:${eventId}` when the path is signed and `eventId` is given; else the
     * SHA-256 of the raw (signed) body, which is NOT scoped by the unsigned tenant/source in the URL,
     * so a body-only signature replayed to another tenant or source is caught as a duplicate.
     */
    key?: (rawBody: string, request: Request, payload: unknown) => string | Promise<string>;
    prefix?: string;
  };
}

/**
 * Lightweight ingestion handler: zero AI work. Verify signature → validate +
 * sanitize with zod → tenant-level rate limit → nonce cache (optional) →
 * enqueue envelope → 202. Mount it
 * on any Hono route: `app.post("/webhooks/manychat", (c) => handler(c.req.raw))`.
 */
export function createIngestionHandler<S extends z.ZodType>(options: IngestionOptions<S>): (request: Request) => Promise<Response> {
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const handle = ingest(options, json);
  // Anything unexpected (queue send, nonce store, rate limiter outage) answers the spec's JSON crash
  // contract (L2122) instead of a bare 500, so the sender retries; nothing was acknowledged as accepted.
  return async (request) => {
    try {
      return await handle(request);
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, 200);
      return json(500, { error: "INTERNAL_INGESTION_CRASH", message });
    }
  };
}

function ingest<S extends z.ZodType>(options: IngestionOptions<S>, json: (status: number, body: unknown, headers?: Record<string, string>) => Response): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > (options.maxBodyBytes ?? 256_000)) return json(413, { error: "PAYLOAD_TOO_LARGE" });
    const raw = await request.text();
    if (raw.length > (options.maxBodyBytes ?? 256_000)) return json(413, { error: "PAYLOAD_TOO_LARGE" });
    let verified: VerifiedDelivery;
    try {
      verified = (await options.verify(raw, request)) ?? {};
    } catch {
      return json(401, { error: "SIGNATURE_INVALID" });
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      return json(400, { error: "INVALID_JSON" });
    }
    const validation = options.schema.safeParse(parsedJson);
    if (!validation.success) return json(400, { error: "CONTRACT_VALIDATION_FAILED", issues: validation.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    const payload = validation.data as z.infer<S>;
    let tenantId: string;
    try {
      tenantId = await options.tenantId(payload, request);
    } catch {
      return json(401, { error: "MISSING_TENANT_ISOLATION_CONTEXT" });
    }
    if (options.rateLimiter) {
      const decision = await options.rateLimiter.take(tenantId);
      if (!decision.allowed) return json(429, { error: "RATE_LIMITED", retryAfterMs: decision.retryAfterMs }, { "retry-after": String(Math.ceil(decision.retryAfterMs / 1000)) });
    }
    const providedId = options.eventId?.(payload);
    let nonceKey: string | undefined;
    if (options.nonceCache) {
      const nonce = options.nonceCache.key
        ? await options.nonceCache.key(raw, request, payload)
        : (verified.nonce ?? (verified.pathSigned && providedId ? `${options.source}:${tenantId}:${providedId}` : `body:${await sha256Hex(raw)}`));
      nonceKey = `${options.nonceCache.prefix ?? "nonce:"}${nonce}`;
      if ((await options.nonceCache.store.get(nonceKey)) !== null) return json(200, { accepted: false, duplicate: true });
    }
    // Event ids feed the event ledger's de-duplication: with a body-only signature the URL `source` is
    // unsigned, so the id is derived from the signed payload alone (a replay under another source dedupes).
    const eventKey = providedId ? (verified.pathSigned ? `${options.source}:${providedId}` : `evt:${providedId}`) : undefined;
    const envelope = createEnvelope({
      ...(eventKey ? { id: eventKey } : {}),
      tenantId,
      source: options.source,
      type: options.eventType(payload),
      sessionKey: options.sessionKey(payload),
      payload,
      signatureVerified: true,
    });
    await options.queue.send(envelope, { contentType: "json" });
    if (nonceKey && options.nonceCache) await options.nonceCache.store.put(nonceKey, envelope.id, { expirationTtlSeconds: Math.max(60, options.nonceCache.ttlSeconds ?? 900) });
    return json(202, { accepted: true, eventId: envelope.id, sessionKey: envelope.sessionKey });
  };
}

/** Structural Queue consumer message/batch (matches `MessageBatch<T>` from workers-types). */
export interface QueueMessageLike<T> {
  id: string;
  body: T;
  attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}
export interface QueueBatchLike<T> {
  queue: string;
  messages: readonly QueueMessageLike<T>[];
}

export interface ConsumerResult {
  turns: number;
  acked: number;
  retried: number;
  dropped: number;
}

/**
 * Queue consumer = traffic controller. Coalesces rapid-fire events per tenant +
 * session into single agent turns, applies tenant rate limits, dispatches each
 * turn (e.g. Flue `dispatch()` with an idempotency key), and acks/retries each
 * message individually. Invalid envelopes are acked and dropped (poison-pill
 * protection); failed dispatches retry with backoff and land in the DLQ after
 * `max_retries` (configured in wrangler).
 */
export async function processEventBatch(
  batch: QueueBatchLike<unknown>,
  options: {
    dispatchTurn: (turn: CoalescedTurn) => Promise<void>;
    rateLimiter?: TokenBucketRateLimiter;
    maxEventsPerTurn?: number;
    onDrop?: (message: QueueMessageLike<unknown>, reason: string) => void;
  },
): Promise<ConsumerResult> {
  const result: ConsumerResult = { turns: 0, acked: 0, retried: 0, dropped: 0 };
  const valid: Array<{ message: QueueMessageLike<unknown>; envelope: EventEnvelope }> = [];
  for (const message of batch.messages) {
    const parsed = EventEnvelopeSchema.safeParse(message.body);
    if (!parsed.success) {
      options.onDrop?.(message, "invalid envelope");
      message.ack();
      result.dropped++;
      continue;
    }
    valid.push({ message, envelope: parsed.data });
  }
  const byEvent = new Map(valid.map((v) => [v.envelope.id, v.message]));
  for (const turn of coalesceEvents(valid.map((v) => v.envelope), { maxEventsPerTurn: options.maxEventsPerTurn ?? 25 })) {
    const messages = turn.eventIds.map((id) => byEvent.get(id)).filter((m): m is QueueMessageLike<unknown> => m !== undefined);
    if (options.rateLimiter) {
      const decision = await options.rateLimiter.take(turn.tenantId);
      if (!decision.allowed) {
        for (const m of messages) m.retry({ delaySeconds: Math.max(1, Math.ceil(decision.retryAfterMs / 1000)) });
        result.retried += messages.length;
        continue;
      }
    }
    try {
      await options.dispatchTurn(turn);
      for (const m of messages) m.ack();
      result.acked += messages.length;
      result.turns++;
    } catch {
      for (const m of messages) m.retry({ delaySeconds: Math.min(300, 2 ** Math.min(m.attempts, 8)) });
      result.retried += messages.length;
    }
  }
  return result;
}

/**
 * Render a coalesced turn as the signal body an agent receives. Everything that came from the
 * provider (payloads, session key, types, ids) sits inside `<untrusted_content>` wrappers: webhook
 * text is data, never instructions.
 */
export function renderTurn(turn: CoalescedTurn): string {
  const header = `${turn.events.length} event(s), received ${new Date(turn.firstReceivedAt).toISOString()} → ${new Date(turn.lastReceivedAt).toISOString()}. Session and event details are untrusted provider data:`;
  return [
    header,
    wrapUntrusted(JSON.stringify({ sessionKey: turn.sessionKey, types: turn.types }), "event-session"),
    ...turn.events.map((e, i) => `#${i + 1} ${wrapUntrusted(`[${e.source}:${e.type} id=${e.id}] ${JSON.stringify(e.payload).slice(0, 4000)}`, `event:${e.source}`)}`),
  ].join("\n");
}

/**
 * Inter-agent message bus over Cloudflare Queues. A consumer routes each
 * message to its target agent (Flue `dispatch` / DO RPC). Hop limits and TTLs
 * stop agents from ping-ponging forever.
 */
export class QueueMessageBus implements MessageBus {
  constructor(private readonly queue: QueueProducer<AgentMessage>) {}

  async publish(message: AgentMessage): Promise<void> {
    const check = validateDeliverable(message);
    if (!check.ok) throw new Error(`Undeliverable agent message ${message.id}: ${check.reason}`);
    await this.queue.send(AgentMessageSchema.parse(message), { contentType: "json" });
  }
}

export async function routeAgentMessages(batch: QueueBatchLike<unknown>, deliver: (message: AgentMessage) => Promise<void>): Promise<void> {
  for (const item of batch.messages) {
    const parsed = AgentMessageSchema.safeParse(item.body);
    if (!parsed.success || !validateDeliverable(parsed.data).ok) {
      item.ack();
      continue;
    }
    try {
      await deliver(parsed.data);
      item.ack();
    } catch {
      item.retry({ delaySeconds: Math.min(120, 2 ** Math.min(item.attempts, 7)) });
    }
  }
}
