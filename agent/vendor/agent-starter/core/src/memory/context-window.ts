import { completeText } from "../models/structured.ts";
import type { ChatMessage, ModelProvider } from "../models/types.ts";
import { estimateTokens, truncateMiddle } from "../util/text.ts";

export interface ContextWindowOptions {
  /** Token budget for the whole prompt (system + history). */
  maxTokens: number;
  /** Keep this many most recent tool results verbatim (sliding window). Default 3. */
  keepRecentToolResults?: number;
  /** Keep this many most recent messages untouched regardless of budget. Default 6. */
  keepRecentMessages?: number;
  /** Cap for any single tool result kept verbatim. */
  maxToolResultChars?: number;
  /** Cheap model that writes the rolling "System History Checklist". */
  summarizer?: ModelProvider;
}

export interface CompactionResult {
  messages: ChatMessage[];
  summary?: string;
  compacted: boolean;
  tokensBefore: number;
  tokensAfter: number;
}

export function messageTokens(message: ChatMessage): number {
  const content = message.content ?? "";
  const extra = message.role === "assistant" && message.toolCalls ? message.toolCalls.reduce((s, c) => s + estimateTokens(c.arguments) + 8, 0) : 0;
  return estimateTokens(content) + extra + 4;
}

/**
 * Sliding-summary context manager (context compression).
 *  1. Older tool results beyond the last N are collapsed to one-line stubs.
 *  2. If still over budget, the oldest turns (outside the protected recent
 *     window) are summarized by a cheap model into a running checklist message.
 * Tool call / tool result pairs are always kept or dropped together so provider
 * APIs never see an orphaned tool result.
 */
export class ContextWindow {
  private readonly options: Required<Omit<ContextWindowOptions, "summarizer">> & { summarizer?: ModelProvider };

  constructor(options: ContextWindowOptions) {
    this.options = {
      keepRecentToolResults: 3,
      keepRecentMessages: 6,
      maxToolResultChars: 8000,
      ...options,
    };
  }

  total(messages: ChatMessage[]): number {
    return messages.reduce((s, m) => s + messageTokens(m), 0);
  }

  async fit(messages: ChatMessage[], previousSummary?: string): Promise<CompactionResult> {
    const tokensBefore = this.total(messages);
    const system = messages.filter((m) => m.role === "system");
    let rest = messages.filter((m) => m.role !== "system");

    // Step 1: collapse stale tool results.
    const toolIndexes = rest.map((m, i) => (m.role === "tool" ? i : -1)).filter((i) => i >= 0);
    const keepVerbatim = new Set(toolIndexes.slice(-this.options.keepRecentToolResults));
    rest = rest.map((m, i) => {
      if (m.role !== "tool") return m;
      if (keepVerbatim.has(i)) return { ...m, content: truncateMiddle(m.content, this.options.maxToolResultChars) };
      return { ...m, content: `[older result of ${m.name} elided: ${m.content.slice(0, 160).replace(/\s+/g, " ")}…]` };
    });

    let candidate = [...system, ...(previousSummary ? [historyMessage(previousSummary)] : []), ...rest];
    if (this.total(candidate) <= this.options.maxTokens) {
      return { messages: candidate, ...(previousSummary ? { summary: previousSummary } : {}), compacted: tokensBefore !== this.total(candidate), tokensBefore, tokensAfter: this.total(candidate) };
    }

    // Step 2: summarize the oldest turns outside the protected window, on a safe boundary.
    let cut = Math.max(0, rest.length - this.options.keepRecentMessages);
    while (cut > 0 && rest[cut]?.role === "tool") cut--;
    const older = rest.slice(0, cut);
    const recent = rest.slice(cut);
    if (older.length === 0) {
      return { messages: candidate, ...(previousSummary ? { summary: previousSummary } : {}), compacted: false, tokensBefore, tokensAfter: this.total(candidate) };
    }
    const summary = await this.summarize(older, previousSummary);
    candidate = [...system, historyMessage(summary), ...recent];
    return { messages: candidate, summary, compacted: true, tokensBefore, tokensAfter: this.total(candidate) };
  }

  private async summarize(older: ChatMessage[], previousSummary?: string): Promise<string> {
    const transcript = older
      .map((m) => {
        if (m.role === "tool") return `TOOL ${m.name}: ${m.content.slice(0, 600)}`;
        if (m.role === "assistant") return `ASSISTANT: ${m.content.slice(0, 1200)}${m.toolCalls?.length ? ` [called ${m.toolCalls.map((c) => c.name).join(", ")}]` : ""}`;
        return `${m.role.toUpperCase()}: ${m.content.slice(0, 1200)}`;
      })
      .join("\n");
    if (this.options.summarizer) {
      try {
        const { text } = await completeText(this.options.summarizer, {
          system: "You maintain a 'System History Checklist' for an AI agent. Merge the previous checklist with the new transcript into concise bullets: user goals and constraints, decisions made, facts learned, actions completed (with ids), open items. Never drop commitments or identifiers.",
          prompt: `PREVIOUS CHECKLIST:\n${previousSummary ?? "(none)"}\n\nNEW TRANSCRIPT:\n${transcript}`,
          maxOutputTokens: 900,
          temperature: 0,
        });
        if (text) return text;
      } catch {
        // fall through to extractive summary
      }
    }
    const extractive = older
      .filter((m) => m.role === "user" || (m.role === "assistant" && m.content))
      .map((m) => `- ${m.role}: ${m.content.slice(0, 200).replace(/\s+/g, " ")}`)
      .slice(-20)
      .join("\n");
    return [previousSummary, extractive].filter(Boolean).join("\n");
  }
}

function historyMessage(summary: string): ChatMessage {
  return { role: "system", content: `[SYSTEM HISTORY CHECKLIST — compressed earlier conversation]\n${summary}` };
}
