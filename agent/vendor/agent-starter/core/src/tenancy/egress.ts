import { AgentError } from "../errors.ts";

/**
 * Egress policy for agent-supplied URLs (SSRF guard). One implementation shared
 * by every fetching tool (Jina/Firecrawl readers, Browser Rendering, custom
 * tools) so the rules never drift apart.
 */
export class SsrfBlockedError extends AgentError {
  constructor(url: string, reason: string) {
    super("GUARDRAIL_BLOCKED", `URL blocked by SSRF guard: ${reason}`, { details: { url: url.slice(0, 500), reason } });
  }
}

function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : Number.NaN));
  return octets.every((o) => Number.isInteger(o) && o >= 0 && o <= 255) ? octets : null;
}

/** True for loopback, private, CGNAT, link-local, multicast, reserved, broadcast and documentation IPv4 ranges. */
export function isPrivateIpv4(octets: number[]): boolean {
  const [a = 0, b = 0, c = 0] = octets;
  return (
    a === 0 || // "this" network 0.0.0.0/8
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64.0.0/10
    (a === 169 && b === 254) || // link-local (cloud metadata)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF protocol assignments, TEST-NET-1
    (a === 192 && b === 88 && c === 99) || // 6to4 relay anycast
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast 224/4 + reserved 240/4 + broadcast
  );
}

function parseIpv6(host: string): number[] | null {
  let text = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (!text.includes(":")) return null;
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);
  // Embedded IPv4 tail (e.g. ::ffff:1.2.3.4) → two hextets.
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    text = `${text.slice(0, lastColon + 1)}${(((v4[0] as number) << 8) | (v4[1] as number)).toString(16)}:${(((v4[2] as number) << 8) | (v4[3] as number)).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...head, ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => "0"), ...rest];
  const values = groups.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? Number.parseInt(g, 16) : Number.NaN));
  return values.length === 8 && values.every((v) => Number.isInteger(v)) ? values : null;
}

/** True for loopback, unspecified, v4-mapped/compatible/translated private, NAT64, 6to4, Teredo, ULA, link-local, site-local, multicast and documentation IPv6. */
export function isPrivateIpv6(groups: number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  const v4At = (hi: number, lo: number) => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
  if (groups.every((g) => g === 0)) return true; // ::
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return true; // ::1
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) return isPrivateIpv4(v4At(g6, g7)); // v4-mapped / v4-compatible
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0xffff && g5 === 0) return isPrivateIpv4(v4At(g6, g7)); // v4-translated ::ffff:0:a.b.c.d
  if (g0 === 0x64 && g1 === 0xff9b) return g2 === 1 || isPrivateIpv4(v4At(g6, g7)); // NAT64 well-known + local-use 64:ff9b:1::/48
  if (g0 === 0x2002) return isPrivateIpv4(v4At(g1, g2)); // 6to4 embeds an IPv4 address
  if (g0 === 0x2001 && g1 === 0) return true; // Teredo tunnels
  if ((g0 & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g0 & 0xffc0) === 0xfec0) return true; // deprecated site-local
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // discard-only
  return false;
}

/** True when `host` (bare or bracketed) is an IP literal in a non-public range. */
export function isPrivateIpAddress(host: string): boolean {
  const v4 = parseIpv4(host);
  if (v4) return isPrivateIpv4(v4);
  const v6 = parseIpv6(host);
  return v6 ? isPrivateIpv6(v6) : false;
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa", ".intranet", ".corp", ".lan"];

/**
 * Throws `SsrfBlockedError` unless `input` is an absolute http(s) URL to a
 * public host: no credentials, no localhost/intranet names or single-label
 * hosts, no private, loopback, link-local, CGNAT, multicast, reserved or
 * documentation IP literals (IPv4, IPv6, v4-mapped/translated, NAT64, 6to4,
 * Teredo; decimal/hex/octal IPv4 forms are normalized by the WHATWG URL parser
 * first). DNS-based rebinding must still be stopped at the egress layer
 * (Cloudflare Workers fetch cannot reach private ranges).
 */
export function assertPublicHttpUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SsrfBlockedError(input, "not an absolute URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SsrfBlockedError(input, `scheme "${url.protocol}" is not allowed`);
  if (url.username || url.password) throw new SsrfBlockedError(input, "credentials in URL are not allowed");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new SsrfBlockedError(input, "missing host");
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) throw new SsrfBlockedError(input, `host "${host}" is local`);
  const v4 = parseIpv4(host);
  if (v4) {
    if (isPrivateIpv4(v4)) throw new SsrfBlockedError(input, `IP ${host} is private, loopback or reserved`);
    return url;
  }
  const v6 = parseIpv6(host);
  if (v6) {
    if (isPrivateIpv6(v6)) throw new SsrfBlockedError(input, `IP ${host} is private, loopback or reserved`);
    return url;
  }
  if (host.includes(":") || host.startsWith("[")) throw new SsrfBlockedError(input, "unparseable IP literal");
  if (!host.includes(".")) throw new SsrfBlockedError(input, `single-label host "${host}" is not public`);
  return url;
}

export function isPublicHttpUrl(input: string): boolean {
  try {
    assertPublicHttpUrl(input);
    return true;
  } catch {
    return false;
  }
}
