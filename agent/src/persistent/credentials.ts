import { type BrokeredFetch, brokeredFetch, createEgressGuard, CredentialBroker, type CredentialSource, type EgressPolicy, parseHostList } from "@agent-starter/core";
import type { PersistentEnv } from "./env.ts";

/**
 * Credential broker sources: credential NAME → Worker secret + the hosts the platform ever allows it on.
 * An agent's config (credentials: [{ name, hosts }]) can only narrow these hosts; widening a binding is a
 * human-reviewed proposal. Tools pass `{ credential: "github" }`; the secret never reaches tool args,
 * results, the model context or logs (the broker scrubs any value it resolved).
 * Add your own: one entry per secret, with the narrowest host list that works.
 */
export function credentialSources(env: PersistentEnv): Record<string, Omit<CredentialSource, "name" | "hosts"> & { hosts: readonly string[] }> {
  const saasHost = hostOf(env.PRIMARY_SAAS_API_URL);
  return {
    github: { hosts: ["api.github.com"], secret: () => env.GITHUB_TOKEN ?? "" },
    ...(saasHost ? { saas: { hosts: [saasHost], secret: () => env.SAAS_SERVICE_TOKEN ?? "" } } : {}),
  };
}

/** The broker for one agent's approved credential bindings. */
export function credentialBroker(env: PersistentEnv, bindings: ReadonlyArray<{ name: string; hosts: readonly string[] }>): CredentialBroker {
  return CredentialBroker.fromConfig(bindings, credentialSources(env));
}

/** Platform egress layers from the Worker vars (the managed allowlist and extra denials). */
export function managedEgress(env: PersistentEnv): { managedAllow: string[]; managedDeny: string[] } {
  return { managedAllow: parseHostList(env.PERSISTENT_EGRESS_ALLOW), managedDeny: parseHostList(env.PERSISTENT_EGRESS_DENY) };
}

/** The egress policy of one agent: the platform allowlist, narrowed (never widened) by the agent's approved config. */
export function agentEgress(env: PersistentEnv, config: { egress: { allow: readonly string[]; deny: readonly string[] } }): EgressPolicy {
  return createEgressGuard({ ...managedEgress(env), agentAllow: [...config.egress.allow], agentDeny: [...config.egress.deny] });
}

/**
 * The fetch platform code uses when it reads the Marketer API on a persistent agent's behalf (decision point 12 in
 * src/agents/persistent.ts). Same walls as the agent's own tools: the egress policy on every hop, the credential
 * injected only for hosts both the platform and the agent's config bind it to and dropped on a redirect to any other
 * host, and a hard timeout. Never the global `fetch` with a resolved token: that would follow a redirect with the
 * service token attached and skip the allowlist.
 */
export function platformBrokeredFetch(env: PersistentEnv, config: { egress: { allow: readonly string[]; deny: readonly string[] }; credentials: ReadonlyArray<{ name: string; hosts: readonly string[] }> }, options: { fetch?: typeof fetch; timeoutMs?: number } = {}): BrokeredFetch {
  const guarded = brokeredFetch({ broker: credentialBroker(env, config.credentials), egress: agentEgress(env, config), ...(options.fetch ? { fetch: options.fetch as never } : {}) });
  const timeoutMs = options.timeoutMs ?? 5_000;
  return (url, init = {}) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    return guarded(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  };
}

function hostOf(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).hostname.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}
