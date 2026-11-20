import { sha256Hex } from "@agent-starter/core";
import type { ManychatWebhookPayload, StripeEventSummary } from "@agent-starter/integrations";

/**
 * Webhook helpers for src/background/routes.ts (pure: the KV namespace is injected).
 *
 * Signatures (SEC-06):
 *  - `/events/:source/:tenantId` and `/webhooks/manychat/:tenantId` use signed requests: the sender signs
 *    method + path + body (`signRequest(secret, { method: "POST", path, body })` → `x-agent-signature:
 *    t=…,v1=…`), so a captured delivery never replays into another tenant, source or route, and replay
 *    nonces / event ids come from signed data only;
 *  - `/webhooks/stripe/:tenantId` uses Stripe's own scheme (`t.body` only), so it accepts ONLY the
 *    tenant's own endpoint secret(s): a shared secret would let one tenant's events replay into another.
 */

export interface SecretKv {
  get(key: string, options?: { cacheTtl?: number }): Promise<string | null>;
}

function parseSecrets(raw: string | null, minLength: number): string[] {
  if (!raw) return [];
  let parsed: unknown = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // plain string secret
  }
  return (Array.isArray(parsed) ? parsed : [parsed]).filter((s): s is string => typeof s === "string" && s.length >= minLength);
}

/**
 * Signing secrets for a tenant's signed-request routes: its own (TENANT_CONFIG `webhook-secrets:<tenantId>`,
 * a JSON array or a single string, >= 16 chars each; list two during rotation) or, for tenants without
 * their own, the shared platform secret(s). The path is signed, so a shared secret is still bound to the
 * tenant in the URL. A tenant with its own secret no longer accepts the shared one.
 */
export async function webhookSecrets(kv: SecretKv, tenantId: string, shared: Array<string | undefined>): Promise<string[]> {
  const own = parseSecrets(await kv.get(`webhook-secrets:${tenantId}`, { cacheTtl: 60 }), 16);
  return own.length ? own : shared.filter((s): s is string => typeof s === "string" && s.length > 0);
}

/** A tenant's Stripe endpoint secrets (`stripe-webhook-secrets:<tenantId>`, `whsec_…`); empty → the route answers 404. */
export async function stripeWebhookSecrets(kv: SecretKv, tenantId: string): Promise<string[]> {
  return parseSecrets(await kv.get(`stripe-webhook-secrets:${tenantId}`, { cacheTtl: 60 }), 16);
}

/** Short hash of a signed raw body (event ids for providers that send none). */
export async function signedBodyHash(rawBody: string): Promise<string> {
  return (await sha256Hex(rawBody)).slice(0, 32);
}

/**
 * Manychat sends no event id. The id comes from signed data only: the contact and a hash of the signed
 * body (a redelivery carries the identical body; an unsigned `x-request-id` header could mint new ids
 * for one delivery and defeat de-duplication).
 */
export function manychatEventId(payload: Pick<ManychatWebhookPayload, "page_id" | "contact">, bodyHash: string): string {
  return `${payload.page_id}:${payload.contact.id}:${bodyHash}`;
}

/** One agent session per Stripe customer (or per object when the event has no customer). */
export function stripeSessionKey(event: Pick<StripeEventSummary, "customer" | "objectId" | "id">): string {
  return event.customer ? `stripe:${event.customer}` : `stripe:${event.objectId ?? event.id}`;
}

/**
 * A tenant's Marketer webhook endpoint secrets (`marketer-webhook-secrets:<tenantId>`, a JSON array or one string,
 * >= 16 chars each; list two while rotating). Marketer signs `${t}.${body}` only (X-Marketer-Signature, the Stripe
 * scheme), so the path and therefore the tenant are NOT signed: the route accepts ONLY the tenant's own endpoint
 * secret (the one the backend returned when the endpoint was registered), never a shared platform secret, so one
 * tenant's events can never replay into another tenant. Empty → the route answers 404.
 */
export async function marketerWebhookSecrets(kv: SecretKv, tenantId: string): Promise<string[]> {
  return parseSecrets(await kv.get(`marketer-webhook-secrets:${tenantId}`, { cacheTtl: 60 }), 16);
}
