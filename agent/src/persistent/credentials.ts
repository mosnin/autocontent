import { CredentialBroker, type CredentialSource, parseHostList } from "@agent-starter/core";
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

function hostOf(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).hostname.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}
