import { assertPublicHttpUrl, defineAgentTool, HttpError, type KeyValueStore, sha256Hex, wrapUntrusted } from "@agent-starter/core";
import { z } from "zod";

/**
 * SSRF guard for agent-supplied URLs. Delegates to the core egress policy
 * (`assertPublicHttpUrl`), the same guard the Jina/Firecrawl readers use:
 * private/loopback/link-local/CGNAT/multicast/reserved IPv4 and IPv6 literals
 * (incl. v4-mapped, NAT64, 6to4), local and single-label hosts, credentials and
 * non-http(s) schemes are rejected with `SsrfBlockedError`.
 */
export function assertPublicUrl(raw: string): URL {
  return assertPublicHttpUrl(raw);
}

export interface BrowserRenderingOptions {
  accountId: string;
  apiToken: string;
  fetch?: typeof fetch;
  /** Cache rendered pages to avoid paying twice for the same URL. */
  cache?: KeyValueStore;
  cacheTtlSeconds?: number;
}

/**
 * Proxied headless fetching via Cloudflare Browser Rendering's REST API: real
 * Chrome renders JS-heavy pages at the edge and returns clean markdown — no VM,
 * no Puppeteer script for the agent to write. Use boat.dev VMs only for
 * interactive multi-step browsing.
 */
export class BrowserRenderingClient {
  constructor(private readonly options: BrowserRenderingOptions) {}

  async markdown(rawUrl: string, options: { waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2"; rejectResourceTypes?: string[] } = {}): Promise<{ url: string; markdown: string; cached: boolean }> {
    const url = assertPublicUrl(rawUrl).toString();
    const key = `br:md:${(await sha256Hex(url)).slice(0, 40)}`;
    const hit = await this.options.cache?.get(key);
    if (hit) return { url, markdown: hit, cached: true };
    const response = await (this.options.fetch ?? fetch)(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.options.accountId)}/browser-rendering/markdown`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.options.apiToken}`, "content-type": "application/json" },
      body: JSON.stringify({ url, gotoOptions: { waitUntil: options.waitUntil ?? "networkidle2", timeout: 30_000 }, rejectResourceTypes: options.rejectResourceTypes ?? ["image", "media", "font"] }),
    });
    if (!response.ok) throw await HttpError.fromResponse(response, "Browser Rendering");
    const body = (await response.json()) as { success?: boolean; result?: string; errors?: Array<{ message: string }> };
    if (!body.success || typeof body.result !== "string") throw new Error(`Browser Rendering failed: ${(body.errors ?? []).map((e) => e.message).join("; ")}`);
    await this.options.cache?.put(key, body.result, { expirationTtlSeconds: this.options.cacheTtlSeconds ?? 3600 });
    return { url, markdown: body.result, cached: false };
  }

  async screenshot(rawUrl: string): Promise<ArrayBuffer> {
    const url = assertPublicUrl(rawUrl).toString();
    const response = await (this.options.fetch ?? fetch)(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.options.accountId)}/browser-rendering/screenshot`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.options.apiToken}`, "content-type": "application/json" },
      body: JSON.stringify({ url, viewport: { width: 1280, height: 720 } }),
    });
    if (!response.ok) throw await HttpError.fromResponse(response, "Browser Rendering screenshot");
    return response.arrayBuffer();
  }
}

/** Agent tool: render a public web page to markdown (read-only, output treated as untrusted). */
export function createBrowsePageTool(client: BrowserRenderingClient) {
  return defineAgentTool({
    name: "browse_page",
    description: "Render a public web page in a real headless browser and return its content as markdown. Use for JavaScript-heavy pages.",
    input: z.object({ url: z.string().url(), maxChars: z.number().int().min(500).max(40_000).default(12_000) }),
    risk: "LOW",
    sideEffect: "read",
    idempotent: true,
    timeoutMs: 45_000,
    execute: async ({ url, maxChars }) => {
      const page = await client.markdown(url);
      return wrapUntrusted(page.markdown.slice(0, maxChars), `web:${new URL(page.url).hostname}`);
    },
  });
}
