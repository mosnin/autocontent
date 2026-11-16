import { z } from "zod";
import { extractJsonBlock, safeJsonParse } from "../util/text.ts";
import type { ModelProvider, ModelRequest, ModelResponse } from "./types.ts";

export interface CompleteOptions {
  system?: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  model?: string;
  reasoningEffort?: ModelRequest["reasoningEffort"];
  signal?: AbortSignal;
  metadata?: Record<string, string>;
}

/** One-shot text completion helper used by small "utility model" calls (compactor, critic, router). */
export async function completeText(provider: ModelProvider, options: CompleteOptions): Promise<{ text: string; response: ModelResponse }> {
  const response = await provider.generate({
    ...(options.model ? { model: options.model } : {}),
    messages: [...(options.system ? [{ role: "system" as const, content: options.system }] : []), { role: "user" as const, content: options.prompt }],
    temperature: options.temperature ?? 0.1,
    ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
    ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
  });
  return { text: response.text.trim(), response };
}

/**
 * Ask a model for JSON matching a zod schema. Uses provider-native JSON schema
 * output when available, tolerates fenced/prefixed output, and retries once with
 * the validation errors fed back.
 */
export async function completeJson<S extends z.ZodType>(
  provider: ModelProvider,
  schema: S,
  options: CompleteOptions & { schemaName?: string; attempts?: number },
): Promise<{ value: z.infer<S>; response: ModelResponse }> {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>;
  const attempts = options.attempts ?? 2;
  let feedback = "";
  let lastError = "no attempt made";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await provider.generate({
      ...(options.model ? { model: options.model } : {}),
      messages: [
        { role: "system", content: `${options.system ?? "You are a precise JSON generator."}\nRespond with a single JSON value only. No markdown, no commentary.` },
        { role: "user", content: `${options.prompt}\n\nJSON Schema:\n${JSON.stringify(jsonSchema)}${feedback}` },
      ],
      temperature: options.temperature ?? 0,
      responseFormat: { type: "json_schema", name: options.schemaName ?? "result", schema: jsonSchema },
      ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
      ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.metadata ? { metadata: options.metadata } : {}),
    });
    const block = extractJsonBlock(response.text) ?? response.text;
    const parsed = safeJsonParse(block);
    if (!parsed.ok) {
      lastError = `invalid JSON: ${parsed.error}`;
      feedback = `\n\nYour previous output was not valid JSON (${parsed.error}). Output corrected JSON only.`;
      continue;
    }
    const validated = schema.safeParse(parsed.value);
    if (validated.success) return { value: validated.data, response };
    lastError = validated.error.issues.map((i) => `${i.path.join(".") || "$"}: ${i.message}`).join("; ");
    feedback = `\n\nYour previous output failed validation: ${lastError}. Output corrected JSON only.`;
  }
  throw new Error(`Model did not return valid structured output: ${lastError}`);
}
