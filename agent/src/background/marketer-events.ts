import { z } from "zod";

/**
 * Marketer pipeline events delivered to `POST /webhooks/marketer/:tenantId` (src/background/routes.ts).
 *
 * The backend (src/marketer/services/webhook_delivery.py) POSTs `{"event": <name>, "data": {...}}` signed with the
 * endpoint's own secret: `X-Marketer-Signature: t=<unix>,v1=<hex hmac_sha256(secret, "<t>.<raw body>")>`. Register
 * the endpoint in Marketer (`POST /api/v1/webhook-endpoints` with url `https://<agents>/webhooks/marketer/<user id>`)
 * and store the returned secret as `marketer-webhook-secrets:<user id>` in the TENANT_CONFIG KV.
 *
 * Every field is bounded and optional where the backend may omit it; free text (titles, errors) stays untrusted data
 * for the agent. `ad.approval_pending` is accepted for when the backend starts emitting it (not in VALID_EVENTS yet).
 */
export const MARKETER_EVENTS = ["job.done", "job.failed", "job.awaiting_approval", "article.done", "article.failed", "ad.approval_pending"] as const;

const id = z.string().uuid();
const text = (max: number) => z.string().max(max).nullish();

export const MarketerEventSchema = z.object({
  event: z.enum(MARKETER_EVENTS),
  data: z
    .object({
      job_id: id.optional(),
      article_id: id.optional(),
      approval_id: id.optional(),
      campaign_id: id.optional(),
      niche_id: id.nullish(),
      platform: text(40),
      status: text(40),
      title: text(300),
      slug: text(300),
      scheduled_for: text(64),
      provider_post_id: text(200),
      error: text(1000),
      summary: text(500),
      dollar_delta_usd: z.union([z.number(), z.string().max(32)]).nullish(),
    })
    .strip(),
});

export type MarketerEvent = z.infer<typeof MarketerEventSchema>;

/** The item an event is about (`video:<id>`, `article:<id>`, `ad_approval:<id>`), or the event name. */
export function marketerEventRef(event: MarketerEvent): string {
  const d = event.data;
  if (d.job_id) return `video:${d.job_id}`;
  if (d.article_id) return `article:${d.article_id}`;
  if (d.approval_id) return `ad_approval:${d.approval_id}`;
  return event.event;
}

/**
 * Event id from signed data only: the event name, the item and the SIGNED timestamp. A provider retry inside the
 * signature window carries the same timestamp and collapses; a later, genuinely new event (a retried job failing
 * again) gets a new one.
 */
export function marketerEventId(event: MarketerEvent, signedTimestamp: number): string {
  return `${event.event}:${marketerEventRef(event)}:${signedTimestamp}`;
}

/** All of an account's pipeline events share one session: a batch becomes one job that summarizes and notifies. */
export const MARKETER_EVENT_SESSION = "marketer-pipeline";
