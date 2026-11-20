import { AgentError } from "../errors.ts";
import { assertPublicHttpUrl } from "../tenancy/egress.ts";

/**
 * Managed egress for persistent agents: an allowlist plus explicit denials on top of the SSRF guard.
 *
 * Layers: the platform (`managedAllow` / `managedDeny`), the tenant (`tenantAllow`) and the agent (`agentAllow` /
 * `agentDeny`). With `managedAllowedDomainsOnly` (the default) the tenant and agent lists can only NARROW the
 * platform allowlist: a host must match every non-empty allow layer. Denials from any layer always win, and
 * `DEFAULT_DENY` (paste sites, request bins, cloud metadata) is always included.
 *
 * Patterns: `example.com` (exact), `*.example.com` (subdomains, not the apex), `*` (any public host). An empty
 * tenant or agent list means "no further narrowing"; an empty platform list allows nothing.
 */
export const DEFAULT_DENY: readonly string[] = ["pastebin.com", "*.pastebin.com", "webhook.site", "metadata.google.internal", "169.254.169.254"];

export class EgressBlockedError extends AgentError {
  constructor(url: string, reason: string) {
    super("GUARDRAIL_BLOCKED", `Egress blocked: ${reason}`, { details: { url: url.slice(0, 500), reason } });
  }
}

export interface EgressGuardOptions {
  managedAllow: readonly string[];
  managedDeny?: readonly string[];
  tenantAllow?: readonly string[];
  agentAllow?: readonly string[];
  agentDeny?: readonly string[];
  /** Default true: lower layers only narrow the platform allowlist. */
  managedAllowedDomainsOnly?: boolean;
}

export interface EgressPolicy {
  /** Throws `SsrfBlockedError` / `EgressBlockedError`, else returns the parsed URL. */
  assertAllowed(url: string): URL;
  isAllowed(url: string): boolean;
  readonly deny: readonly string[];
}

export function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  const p = pattern.trim().toLowerCase();
  if (p === "*") return true;
  if (p.startsWith("*.")) return h.endsWith(p.slice(1)) && h.length > p.length - 1;
  return h === p;
}

const matchesAny = (host: string, list: readonly string[]) => list.some((p) => hostMatches(host, p));

export function createEgressGuard(options: EgressGuardOptions): EgressPolicy {
  const deny = [...new Set([...DEFAULT_DENY, ...(options.managedDeny ?? []), ...(options.agentDeny ?? [])].map((p) => p.trim().toLowerCase()))];
  const narrowing = options.managedAllowedDomainsOnly !== false;
  const layers = [options.tenantAllow, options.agentAllow].filter((l): l is readonly string[] => Array.isArray(l) && l.length > 0);
  const assertAllowed = (input: string): URL => {
    const url = assertPublicHttpUrl(input);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (matchesAny(host, deny)) throw new EgressBlockedError(input, `host "${host}" is on the deny list`);
    if (narrowing) {
      if (!matchesAny(host, options.managedAllow)) throw new EgressBlockedError(input, `host "${host}" is not on the managed allowlist`);
      for (const layer of layers) if (!matchesAny(host, layer)) throw new EgressBlockedError(input, `host "${host}" is not on the agent/tenant allowlist`);
    } else if (!matchesAny(host, [...options.managedAllow, ...layers.flat()])) {
      throw new EgressBlockedError(input, `host "${host}" is not on any allowlist`);
    }
    return url;
  };
  return {
    assertAllowed,
    isAllowed(url: string) {
      try {
        assertAllowed(url);
        return true;
      } catch {
        return false;
      }
    },
    deny,
  };
}

/** Split a comma/whitespace-separated host list (e.g. the `PERSISTENT_EGRESS_ALLOW` var). */
export function parseHostList(value: string | undefined | null): string[] {
  return (value ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * A fetch that checks every hop (redirects are followed manually, at most `maxRedirects`) against the policy.
 * `onHop` lets a caller adjust headers per hop (the credential broker strips credentials for unbound hosts).
 */
export async function guardedFetch(
  policy: EgressPolicy,
  url: string,
  init: RequestInit = {},
  options: { fetch?: FetchLike; maxRedirects?: number; onHop?: (url: URL, headers: Headers) => Promise<void> | void } = {},
): Promise<Response> {
  const doFetch = options.fetch ?? ((u: string, i?: RequestInit) => fetch(u, i));
  let current = url;
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body ?? undefined;
  const { body: _ignored, method: _m, headers: _h, ...rest } = init;
  for (let hop = 0; hop <= (options.maxRedirects ?? 5); hop++) {
    const target = policy.assertAllowed(current);
    const headers = new Headers(_h);
    await options.onHop?.(target, headers);
    const response = await doFetch(target.toString(), { ...rest, method, headers, ...(body !== undefined ? { body } : {}), redirect: "manual" });
    if (response.status < 300 || response.status >= 400 || !response.headers.get("location")) return response;
    current = new URL(response.headers.get("location") as string, target).toString();
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
      method = "GET";
      body = undefined;
    }
  }
  throw new EgressBlockedError(url, "too many redirects");
}
