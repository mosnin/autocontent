import { readFileSync } from 'node:fs';
import { ONBOARDING_EVENTS } from '../../spec/src/index.ts';
import type { RawEvent } from './metrics.ts';

export interface PostHogSourceOptions {
  /** e.g. https://us.posthog.com or https://eu.posthog.com or a self-hosted URL. */
  host: string;
  projectId: string;
  /** Personal API key with query:read. Never hard-code; read from env. */
  apiKey: string;
  days?: number;
  /** Extra event names to include (e.g. the spec's aha event). */
  extraEvents?: string[];
  limit?: number;
  fetchImpl?: typeof fetch;
}

/** Pull onboarding events from PostHog with one HogQL query. */
export async function fromPostHog(opts: PostHogSourceOptions): Promise<RawEvent[]> {
  const names = [...Object.keys(ONBOARDING_EVENTS), ...(opts.extraEvents ?? [])].map((n) => `'${n.replace(/'/g, '')}'`).join(', ');
  const days = Math.max(1, Math.min(365, Math.floor(opts.days ?? 14)));
  const query = `SELECT event, distinct_id, toUnixTimestamp64Milli(timestamp) AS ts, properties FROM events WHERE event IN (${names}) AND timestamp > now() - INTERVAL ${days} DAY ORDER BY timestamp ASC LIMIT ${opts.limit ?? 100000}`;
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${opts.host.replace(/\/$/, '')}/api/projects/${encodeURIComponent(opts.projectId)}/query/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  });
  if (!res.ok) throw new Error(`PostHog query failed: ${res.status} ${await res.text().catch(() => '')}`.trim());
  const json = (await res.json()) as { results?: unknown[][] };
  return (json.results ?? []).map(([event, distinctId, ts, props]) => ({
    event: String(event),
    distinctId: String(distinctId),
    timestamp: Number(ts),
    properties: typeof props === 'string' ? safeParse(props) : ((props as Record<string, unknown>) ?? {}),
  }));
}

/** Read events from a JSONL export: one { event, distinctId|distinct_id, timestamp, properties } per line. */
export function fromJsonl(path: string): RawEvent[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      const o = JSON.parse(l) as Record<string, unknown>;
      const ts = o.timestamp;
      return {
        event: String(o.event),
        distinctId: String(o.distinctId ?? o.distinct_id),
        timestamp: typeof ts === 'number' ? ts : Date.parse(String(ts)),
        properties: (typeof o.properties === 'string' ? safeParse(o.properties) : o.properties) as Record<string, unknown>,
      };
    });
}

export function toJsonl(events: RawEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}
