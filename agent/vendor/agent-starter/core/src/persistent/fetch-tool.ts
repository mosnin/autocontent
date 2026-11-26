import { z } from "zod";
import { defineAgentTool, type AnyAgentTool } from "../tools/define.ts";
import { brokeredFetch, CredentialBroker } from "./credentials.ts";
import type { EgressPolicy, FetchLike } from "./egress.ts";

export const GUARDED_FETCH_TOOL = "fetch_url";

/**
 * The one safe fetch path of a persistent agent: every hop is checked against the egress policy (allowlist,
 * denials, SSRF guard), a named credential is injected by the broker only for its bound hosts, the caller cannot
 * set headers, and secret values are scrubbed from the response before the model reads it.
 */
export function createGuardedFetchTool(options: { egress: () => EgressPolicy; broker?: () => CredentialBroker | undefined; fetch?: FetchLike; maxBodyChars?: number }): AnyAgentTool {
  return defineAgentTool({
    name: GUARDED_FETCH_TOOL,
    description: "Fetch an http(s) URL on your egress allowlist. Pass `credential` (a credential name from your policy) to call an API that needs auth; you never see the secret.",
    input: z.object({
      url: z.string().url().max(2000),
      method: z.enum(["GET", "POST"]).default("GET"),
      body: z.string().max(20_000).optional(),
      contentType: z.string().max(100).optional(),
      credential: z.string().max(40).optional(),
    }),
    risk: "MEDIUM",
    sideEffect: "external",
    outputTrust: "untrusted",
    timeoutMs: 30_000,
    execute: async ({ url, method, body, contentType, credential }, ctx) => {
      const broker = options.broker?.();
      const fetcher = brokeredFetch({ broker: broker ?? new CredentialBroker([]), egress: options.egress(), ...(options.fetch ? { fetch: options.fetch } : {}) });
      const response = await fetcher(url, {
        method,
        ...(body !== undefined ? { body } : {}),
        ...(contentType ? { headers: { "content-type": contentType } } : {}),
        ...(credential ? { credential } : {}),
        signal: ctx.signal,
      });
      const text = (await response.text()).slice(0, options.maxBodyChars ?? 50_000);
      return { status: response.status, contentType: response.headers.get("content-type") ?? "", body: broker ? broker.scrub(text) : text };
    },
  });
}
