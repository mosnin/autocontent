import { type AnyAgentTool, defineAgentTool } from "@agent-starter/core";
import { createWebSearchTool, createWebTools } from "@agent-starter/integrations";
import * as v from "valibot";
import { retriever, webReaders, webSearchProviders } from "../lib/platform.ts";

/**
 * Read-only tools for the orchestrator's ephemeral subagents (researcher, critic): tenant knowledge retrieval
 * (Vectorize memory + AI Search, re-ranked, scoped to the acting user's tenant), page reading and, with a key, web
 * search (both follow `integrations.jina` / `integrations.firecrawl` in agent-starter.config.ts). Every tool is LOW risk and `read`, so `useSubagentTools` accepts them; results are untrusted data.
 */
export function researchTools(): AnyAgentTool[] {
  const readers = webReaders();
  const tools: AnyAgentTool[] = [
    defineAgentTool({
      name: "search_knowledge",
      description: "Search this workspace's knowledge (documents, help center, saved notes) for passages relevant to a question. Returns excerpts with references.",
      input: v.object({ query: v.pipe(v.string(), v.minLength(2), v.maxLength(400)) }),
      risk: "LOW",
      sideEffect: "read",
      idempotent: true,
      outputTrust: "untrusted",
      execute: async ({ query }, ctx) => {
        const hits = await retriever(ctx.tenant).retrieve(query, { topK: 6 });
        return hits.length ? hits.map((h, i) => ({ ref: i + 1, title: h.metadata.title ?? h.id, excerpt: h.text.slice(0, 1500), score: Number(h.score.toFixed(3)) })) : "No relevant passages found.";
      },
    }),
    ...(readers.jina || readers.firecrawl ? createWebTools(readers) : []),
  ];
  const providers = webSearchProviders();
  if (providers.length) tools.push(createWebSearchTool(providers));
  return tools;
}
