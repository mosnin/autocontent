import { AgentError } from "../errors.ts";
import { type EgressPolicy, type FetchLike, guardedFetch, hostMatches } from "./egress.ts";

/**
 * Credential broker: tools name a credential (`{ credential: "github" }`) and never see the secret. The broker
 * injects the header only for the hosts the credential is bound to, strips it on a redirect to any other host,
 * and scrubs secret values out of any text before it reaches the model, logs or telemetry.
 */
export class CredentialDeniedError extends AgentError {
  constructor(name: string, host: string, reason: string) {
    super("GUARDRAIL_BLOCKED", `Credential "${name}" refused for ${host}: ${reason}`, { details: { credential: name, host } });
  }
}

export interface CredentialSource {
  name: string;
  /** Host patterns the credential may be sent to (`api.github.com`, `*.example.com`). */
  hosts: readonly string[];
  /** Reads the secret (a Worker secret binding). Called lazily; never logged. */
  secret: () => string | Promise<string>;
  /** Header name. Default `authorization`. */
  header?: string;
  /** Value prefix. Default `Bearer ` for the authorization header, none otherwise. */
  prefix?: string;
}

const REDACTED = "[REDACTED_CREDENTIAL]";

export class CredentialBroker {
  private readonly sources = new Map<string, CredentialSource>();
  private readonly seen = new Set<string>();

  constructor(sources: readonly CredentialSource[]) {
    for (const source of sources) this.sources.set(source.name, source);
  }

  /**
   * Bind secrets to the hosts the control-plane config allows: a credential is usable only when it appears in
   * `bindings` (the approved config) AND has a secret, and only for the intersection of hosts when the secret
   * provider also restricts hosts.
   */
  static fromConfig(bindings: ReadonlyArray<{ name: string; hosts: readonly string[] }>, secrets: Record<string, Omit<CredentialSource, "name" | "hosts"> & { hosts?: readonly string[] }>): CredentialBroker {
    const sources: CredentialSource[] = [];
    for (const binding of bindings) {
      const secret = secrets[binding.name];
      if (!secret) continue;
      const hosts = secret.hosts?.length ? binding.hosts.filter((h) => secret.hosts?.includes(h)) : binding.hosts;
      if (hosts.length) sources.push({ ...secret, name: binding.name, hosts });
    }
    return new CredentialBroker(sources);
  }

  names(): string[] {
    return [...this.sources.keys()];
  }

  /** Headers for `name` on `url`, or throws `CredentialDeniedError` (unknown credential or unbound host). */
  async resolve(name: string, url: string | URL): Promise<Record<string, string>> {
    const target = typeof url === "string" ? new URL(url) : url;
    const host = target.hostname.toLowerCase();
    const source = this.sources.get(name);
    if (!source) throw new CredentialDeniedError(name, host, "unknown credential");
    if (target.protocol !== "https:") throw new CredentialDeniedError(name, host, "credentials are only sent over https");
    if (!source.hosts.some((p) => hostMatches(host, p))) throw new CredentialDeniedError(name, host, "host is not bound to this credential");
    const value = await source.secret();
    if (!value) throw new CredentialDeniedError(name, host, "secret is not configured");
    this.seen.add(value);
    const header = (source.header ?? "authorization").toLowerCase();
    const prefix = source.prefix ?? (header === "authorization" ? "Bearer " : "");
    return { [header]: `${prefix}${value}` };
  }

  /** True when `name` may be sent to `url`'s host (no secret read). */
  allows(name: string, url: string | URL): boolean {
    const source = this.sources.get(name);
    if (!source) return false;
    const target = typeof url === "string" ? new URL(url) : url;
    return target.protocol === "https:" && source.hosts.some((p) => hostMatches(target.hostname, p));
  }

  /** Replace every secret value this broker has resolved with a marker. */
  scrub(text: string): string {
    let out = text;
    for (const secret of this.seen) if (secret.length >= 4) out = out.split(secret).join(REDACTED);
    return out;
  }

  /** Header names this broker may set (strip them from caller-supplied headers). */
  headerNames(): string[] {
    return [...new Set([...this.sources.values()].map((s) => (s.header ?? "authorization").toLowerCase()))];
  }
}

export interface BrokeredFetchOptions {
  broker: CredentialBroker;
  egress: EgressPolicy;
  fetch?: FetchLike;
  maxRedirects?: number;
}

export type BrokeredFetch = (url: string, init?: RequestInit & { credential?: string }) => Promise<Response>;

/**
 * Fetch through the egress policy with a named credential. Caller-supplied credential headers are dropped (a tool
 * cannot smuggle its own token), the credential is injected per hop only for bound hosts, and an unbound
 * credential fails before any request is sent.
 */
export function brokeredFetch(options: BrokeredFetchOptions): BrokeredFetch {
  return async (url, init = {}) => {
    const { credential, ...rest } = init;
    if (credential) {
      const first = options.egress.assertAllowed(url);
      if (!options.broker.allows(credential, first)) await options.broker.resolve(credential, first);
    }
    const managed = options.broker.headerNames();
    return guardedFetch(options.egress, url, rest, {
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.maxRedirects !== undefined ? { maxRedirects: options.maxRedirects } : {}),
      onHop: async (target, headers) => {
        for (const name of managed) headers.delete(name);
        if (credential && options.broker.allows(credential, target)) {
          for (const [k, v] of Object.entries(await options.broker.resolve(credential, target))) headers.set(k, v);
        }
      },
    });
  };
}
