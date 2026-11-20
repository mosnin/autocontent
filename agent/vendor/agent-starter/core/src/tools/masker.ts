import { z } from "zod";
import { completeJson } from "../models/structured.ts";
import type { ModelProvider } from "../models/types.ts";
import { maskTools } from "./executor.ts";

const SelectionSchema = z.object({ tools: z.array(z.string()).max(32) });

/**
 * Dynamic tool masking. With 50+ tools/MCP capabilities, sending every schema on
 * every turn wastes input tokens and degrades tool selection. A first-line model
 * picks the handful relevant to the current event; keyword scoring is the
 * zero-cost fallback.
 */
export async function selectRelevantTools<T extends { name: string; description: string; tags?: string[] }>(
  tools: T[],
  task: string,
  options: { provider?: ModelProvider; maxTools?: number; alwaysInclude?: string[] } = {},
): Promise<T[]> {
  const max = options.maxTools ?? 6;
  const always = new Set(options.alwaysInclude ?? []);
  const others = tools.filter((t) => !always.has(t.name));
  if (others.length <= max) return tools;
  if (!options.provider) return maskTools(tools, task, options);
  try {
    const { value } = await completeJson(options.provider, SelectionSchema, {
      system: "You select the minimal set of tools an agent needs for a task. Choose only from the provided names.",
      prompt: `Task:\n${task.slice(0, 4000)}\n\nTools:\n${others.map((t) => `- ${t.name}: ${t.description.slice(0, 160)}`).join("\n")}\n\nReturn at most ${max} tool names.`,
      schemaName: "tool_selection",
    });
    // The model's picks in its own order, capped at `max`; always-included tools ride on top.
    const known = new Set(others.map((t) => t.name));
    const picked = new Set([...new Set(value.tools)].filter((name) => known.has(name)).slice(0, max));
    if (picked.size === 0) return maskTools(tools, task, options);
    return tools.filter((t) => always.has(t.name) || picked.has(t.name));
  } catch {
    return maskTools(tools, task, options);
  }
}
