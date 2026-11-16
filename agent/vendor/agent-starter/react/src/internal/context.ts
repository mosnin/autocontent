import { buildMessage, parseMessage } from "@openuidev/react-lang";

const MARKER = "]]>openui:";

/**
 * Serializes structured context into a user message using the OpenUI
 * message protocol (`buildMessage`): a `content` section with the user's text
 * and a `context` section with JSON. Agents read it back with
 * `parseMessage()` from `@openuidev/react-lang` (or `@openuidev/lang-core`),
 * and models can read the marked sections directly.
 */
export function withContext(text: string, context: unknown): string {
  if (context === undefined || context === null) return text;
  return buildMessage({ content: text, context });
}

/** Splits a message written by `withContext` back into its text and context. */
export function readMessageContext(raw: string): { text: string; context: unknown } {
  if (!raw.includes(MARKER)) return { text: raw, context: null };
  const parsed = parseMessage(raw);
  return { text: parsed.content, context: parsed.context };
}
