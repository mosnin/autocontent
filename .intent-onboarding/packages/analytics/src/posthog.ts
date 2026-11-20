import { ONBOARDING_EVENTS } from '../../spec/src/index.ts';
import type { AnalyticsAdapter } from '../../core/src/index.ts';

/** posthog-js shape: capture(event, properties). */
interface BrowserClient {
  capture(event: string, properties?: Record<string, unknown>): unknown;
  getFeatureFlag?(key: string): string | boolean | undefined;
}
/** posthog-node shape: capture({ distinctId, event, properties }). */
interface NodeClient {
  capture(msg: { distinctId: string; event: string; properties?: Record<string, unknown> }): unknown;
  getFeatureFlag?(key: string, distinctId: string): Promise<string | boolean | undefined>;
}

export interface PostHogAdapterOptions {
  /** Required for posthog-node (server) clients. */
  distinctId?: () => string | undefined;
  /** Warn in development when an event is missing schema properties (RULES §9.1). */
  validate?: boolean;
  /** Prefix for event names, if the host namespaces events. Default: none. */
  prefix?: string;
  onWarn?: (msg: string) => void;
}

/**
 * Analytics adapter for PostHog. Accepts either posthog-js (browser) or posthog-node (server).
 * Events and properties are sent verbatim from the standard schema, so every metric in
 * ONBOARDING_METRICS is computable in PostHog without any mapping.
 */
export function posthogAdapter(client: BrowserClient | NodeClient, opts: PostHogAdapterOptions = {}): AnalyticsAdapter {
  const warn = opts.onWarn ?? ((m: string) => console.warn(`[intent-onboarding] ${m}`));
  const isNode = typeof opts.distinctId === 'function';
  return {
    capture(event, properties) {
      if (opts.validate) {
        const schema = (ONBOARDING_EVENTS as Record<string, readonly string[]>)[event];
        if (schema) for (const k of schema) if (!(k in properties)) warn(`event "${event}" is missing property "${k}"`);
      }
      const name = `${opts.prefix ?? ''}${event}`;
      if (isNode) {
        const distinctId = opts.distinctId!();
        if (!distinctId) return warn(`dropped "${event}": no distinctId`);
        (client as NodeClient).capture({ distinctId, event: name, properties });
      } else {
        (client as BrowserClient).capture(name, properties);
      }
    },
  };
}

/**
 * Read the experiment variant for the onboarding flow from a PostHog feature flag, so every event
 * carries `variant` (pass the result to createOnboarding({ variant })). Falls back to 'control'.
 */
export function variantFromFlag(client: BrowserClient, flagKey = 'onboarding-flow'): string {
  const v = client.getFeatureFlag?.(flagKey);
  return typeof v === 'string' ? v : v === true ? 'intent' : 'control';
}
