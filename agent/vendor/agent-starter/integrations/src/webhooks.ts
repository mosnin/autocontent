import { AgentError, cleanseUntrustedText, hmacSha256Hex, timingSafeEqual, untrustedString } from "@agent-starter/core";
import { z } from "zod";

/**
 * Inbound webhook contracts. Everything a third party sends is bounded and
 * every free-text field is cleansed (`untrustedString`) before it can reach a
 * prompt.
 */

/** Coerce number/boolean/null custom-field values to strings before cleansing. */
const untrustedValue = (max: number) =>
  z.preprocess((value) => (typeof value === "number" || typeof value === "boolean" ? String(value) : value === null || value === undefined ? "" : value), untrustedString(max));

export const ManychatCustomFieldSchema = z.object({
  id: z.union([z.number().int().nonnegative(), z.string().min(1).max(64)]),
  name: untrustedString(64),
  type: z.enum(["text", "number", "boolean", "date", "datetime"]),
  value: untrustedValue(2048),
});

export const ManychatContactSchema = z.object({
  id: z.number().int().positive(),
  first_name: untrustedString(64).default("User"),
  last_name: untrustedString(64).optional(),
  language: z.string().max(8).default("en"),
  timezone: z.string().max(32).default("UTC"),
  custom_fields: z.array(ManychatCustomFieldSchema).max(200).default([]),
});

export const ManychatWebhookPayloadSchema = z.object({
  event: z.literal("manychat_contact_updated"),
  page_id: z.union([z.string().min(1).max(64), z.number().int().positive()]).transform((v) => String(v)),
  contact: ManychatContactSchema,
});
export type ManychatWebhookPayload = z.infer<typeof ManychatWebhookPayloadSchema>;

/** Generic inbound chat message (web widget, WhatsApp/Messenger bridges, Slack relays...). */
export const ChatMessageEventSchema = z.object({
  type: z.literal("chat.message").default("chat.message"),
  id: z.string().min(1).max(128),
  channel: z.string().min(1).max(32).regex(/^[a-z0-9_.-]+$/i),
  conversationId: z.string().min(1).max(128),
  sender: z.object({
    id: z.string().min(1).max(128),
    name: untrustedString(128).optional(),
    role: z.enum(["user", "agent", "system"]).default("user"),
  }),
  text: untrustedString(8000),
  attachments: z
    .array(
      z.object({
        url: z.url({ protocol: /^https?$/ }).max(2048),
        contentType: z.string().max(128).optional(),
        name: untrustedString(256).optional(),
        sizeBytes: z.number().int().nonnegative().optional(),
      }),
    )
    .max(10)
    .default([]),
  timestamp: z.union([z.number().int().nonnegative(), z.iso.datetime({ offset: true })]).transform((v) => (typeof v === "number" ? v : Date.parse(v))),
  locale: z.string().max(16).optional(),
  metadata: z.record(z.string().max(64), z.union([z.string().max(512), z.number(), z.boolean()])).optional(),
});
export type ChatMessageEvent = z.infer<typeof ChatMessageEventSchema>;

/** Stripe event envelope (`data.object` stays an opaque record; narrow it per event type). */
export const StripeEventSchema = z.object({
  id: z.string().min(1).max(255),
  object: z.literal("event").optional(),
  type: z.string().min(1).max(255),
  created: z.number().int().nonnegative(),
  livemode: z.boolean().optional(),
  api_version: z.string().nullable().optional(),
  pending_webhooks: z.number().int().nonnegative().optional(),
  request: z.object({ id: z.string().nullable().optional(), idempotency_key: z.string().nullable().optional() }).nullable().optional(),
  data: z.object({
    object: z.record(z.string(), z.unknown()),
    previous_attributes: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type StripeEvent = z.infer<typeof StripeEventSchema>;

export const STRIPE_SIGNATURE_HEADER = "stripe-signature";

/**
 * Verify a `Stripe-Signature` header (`t=<unix>,v1=<hex>[,v1=<hex>...]`):
 * HMAC-SHA256 hex of `${t}.${rawBody}` with the endpoint secret, compared in
 * constant time against every v1 entry (Stripe sends several during secret
 * rotation), and `t` must be within `toleranceSec` of now. Pass several
 * endpoint secrets (`[current, previous]`) while you roll one on your side.
 * Throws `AgentError("SIGNATURE_INVALID")`; returns the signed timestamp.
 */
export async function verifyStripeSignature(secret: string | readonly string[], rawBody: string, header: string | null | undefined, toleranceSec = 300, now: () => number = Date.now): Promise<{ timestamp: number }> {
  const secrets = (typeof secret === "string" ? [secret] : [...secret]).filter((s) => typeof s === "string" && s.length > 0);
  if (secrets.length === 0) throw new AgentError("CONFIG_INVALID", "Stripe webhook secret is not configured.");
  if (!header) throw new AgentError("SIGNATURE_INVALID", "Missing Stripe-Signature header");
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t" && /^\d+$/.test(value)) timestamp = Number(value);
    else if (key === "v1" && /^[0-9a-f]+$/i.test(value)) signatures.push(value.toLowerCase());
  }
  if (timestamp === undefined || signatures.length === 0) throw new AgentError("SIGNATURE_INVALID", "Malformed Stripe-Signature header");
  if (toleranceSec > 0 && Math.abs(Math.floor(now() / 1000) - timestamp) > toleranceSec) {
    throw new AgentError("SIGNATURE_INVALID", "Stripe signature timestamp outside tolerance window");
  }
  let matched = false;
  for (const key of secrets) {
    const expected = await hmacSha256Hex(key, `${timestamp}.${rawBody}`);
    for (const candidate of signatures) if (timingSafeEqual(expected, candidate)) matched = true;
  }
  if (!matched) throw new AgentError("SIGNATURE_INVALID", "Stripe signature mismatch");
  return { timestamp };
}

/** Verify then parse a Stripe webhook body in one step. */
export async function parseStripeEvent(secret: string | readonly string[], rawBody: string, header: string | null | undefined, toleranceSec = 300): Promise<StripeEvent> {
  await verifyStripeSignature(secret, rawBody, header, toleranceSec);
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new AgentError("TOOL_VALIDATION_FAILED", "Stripe webhook body is not valid JSON");
  }
  return StripeEventSchema.parse(json);
}

const STRIPE_ID = /^[A-Za-z0-9_]{1,255}$/;
const stripeId = (value: unknown): string | null => (typeof value === "string" && STRIPE_ID.test(value) ? value : null);
const boundedNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/**
 * What an agent sees of a Stripe event: ids, type, amounts and statuses, plus cleansed metadata and
 * description. Never the raw `data.object` (arbitrary customer-controlled text, PII such as addresses
 * and card details); fetch more through a typed tool when a job needs it.
 */
export interface StripeEventSummary {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  /** `data.object.object`, e.g. "invoice", "charge", "customer.subscription". */
  objectType: string | null;
  objectId: string | null;
  customer: string | null;
  amount: number | null;
  currency: string | null;
  status: string | null;
  description: string | null;
  metadata: Record<string, string>;
  previousAttributes: string[];
}

export function summarizeStripeEvent(event: StripeEvent): StripeEventSummary {
  const object = event.data.object;
  const customerRaw = object.customer;
  const customer = stripeId(typeof customerRaw === "object" && customerRaw !== null ? (customerRaw as { id?: unknown }).id : customerRaw);
  const amount = boundedNumber(object.amount_total) ?? boundedNumber(object.amount_due) ?? boundedNumber(object.amount) ?? boundedNumber(object.amount_paid);
  const metadataRaw = object.metadata && typeof object.metadata === "object" && !Array.isArray(object.metadata) ? (object.metadata as Record<string, unknown>) : {};
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadataRaw).slice(0, 20)) {
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(key) || (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")) continue;
    metadata[key] = cleanseUntrustedText(String(value), 200);
  }
  return {
    id: event.id,
    type: event.type,
    created: event.created,
    livemode: event.livemode === true,
    objectType: typeof object.object === "string" && /^[a-z_.]{1,64}$/.test(object.object) ? object.object : null,
    objectId: stripeId(object.id),
    customer,
    amount,
    currency: typeof object.currency === "string" && /^[a-z]{3}$/.test(object.currency) ? object.currency : null,
    status: typeof object.status === "string" && /^[a-z_]{1,40}$/.test(object.status) ? object.status : null,
    description: typeof object.description === "string" ? cleanseUntrustedText(object.description, 500) : null,
    metadata,
    previousAttributes: Object.keys(event.data.previous_attributes ?? {})
      .filter((key) => /^[a-z0-9_.]{1,64}$/.test(key))
      .slice(0, 30),
  };
}

/** Ingestion contract for Stripe webhooks: validates the envelope, then keeps only the prompt-safe summary. */
export const StripeWebhookEventSchema = StripeEventSchema.transform(summarizeStripeEvent);

/** Render a Manychat contact as a compact, prompt-safe profile line. */
export function describeManychatContact(contact: ManychatWebhookPayload["contact"]): string {
  const fields = contact.custom_fields.map((f) => `${f.name}=${f.value}`).join("; ");
  return cleanseUntrustedText(`${contact.first_name}${contact.last_name ? ` ${contact.last_name}` : ""} (lang ${contact.language}, tz ${contact.timezone})${fields ? ` — ${fields}` : ""}`, 4000);
}
