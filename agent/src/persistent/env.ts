import type { Env } from "../env.ts";

/**
 * Bindings the persistent module adds (module.json vars/secrets + the PERSISTENT_CONTROL Durable Object).
 * Optional so every module combination type-checks.
 */
export interface PersistentEnv extends Env {
  /** One PersistentAgentControl per persistent agent, named `<tenantId>/<agentId>`. */
  PERSISTENT_CONTROL?: DurableObjectNamespace;
  /** Platform egress allowlist (comma/space list, `*.example.com` allowed). Agents and tenants can only narrow it. Empty: no outbound fetches. */
  PERSISTENT_EGRESS_ALLOW?: string;
  /** Extra denied hosts on top of core DEFAULT_DENY (pastebin, webhook.site, cloud metadata). */
  PERSISTENT_EGRESS_DENY?: string;
  /** Model of the auto-reviewer (a Workers AI model id). Empty: the first-line utility model. A config's autoReview.model wins. */
  PERSISTENT_REVIEW_MODEL?: string;
  /** Signs the agent assertion sent to your SaaS (sub agent:…, act user:…, ≤ 5 min). Rotate with _PREVIOUS. */
  PERSISTENT_ASSERTION_SECRET?: string;
  PERSISTENT_ASSERTION_SECRET_PREVIOUS?: string;
}

/** Bindings typed with the persistent additions. */
export const persistentEnv = (env: Env): PersistentEnv => env as PersistentEnv;
