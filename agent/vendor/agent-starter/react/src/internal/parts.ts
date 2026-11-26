import type { FlueConversationMessage, FlueConversationPart } from "@flue/sdk";
import { z } from "zod";
import type { AgentUsage, ApprovalRequest, OpenUIPayload, TelemetryEvent } from "../types.ts";
import { dedupeTelemetry, parseTelemetryPayload } from "./telemetry.ts";

/** A Flue `data-${name}` part written by an agent's `useDataWriter`. */
export type DataPart = Extract<FlueConversationPart, { type: `data-${string}` }>;
export type ToolPart = Extract<FlueConversationPart, { type: "dynamic-tool" }>;
export type FilePart = Extract<FlueConversationPart, { type: "file" }>;

const NON_DATA_TYPES = new Set(["text", "reasoning", "file", "dynamic-tool"]);

export function isDataPart(part: FlueConversationPart): part is DataPart {
  return part.type.startsWith("data-") && !NON_DATA_TYPES.has(part.type);
}

/**
 * Whether a data part carries the named channel. `data-approval` matches
 * `approval`, and so do keyed writers such as `data-approval-apr_123`, which
 * agents use to keep several approvals in one response (a later write to the
 * same name replaces the part in place).
 */
export function isDataPartNamed(part: FlueConversationPart, name: string): part is DataPart {
  return isDataPart(part) && dataPartMatches(part, name);
}

/** Same check as `isDataPartNamed`, for a part already known to be a data part. */
export function dataPartMatches(part: DataPart, name: string): boolean {
  return part.type === `data-${name}` || part.type.startsWith(`data-${name}-`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const approvalStatusSchema = z.enum(["PENDING_APPROVAL", "APPROVED", "REJECTED", "EXPIRED"]);

export const approvalRequestSchema = z.object({
  approvalId: z.string().min(1),
  tool: z.string(),
  riskTier: z.string(),
  reason: z.string(),
  args: z.unknown(),
  approveUrl: z.string().optional(),
  rejectUrl: z.string().optional(),
  status: approvalStatusSchema.default("PENDING_APPROVAL"),
});

/** Validates approval payloads: one request, an array, or `{ approvals: [...] }`. Invalid entries are dropped. */
export function parseApprovals(data: unknown): ApprovalRequest[] {
  const list = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.approvals) ? data.approvals : [data];
  const approvals: ApprovalRequest[] = [];
  for (const entry of list) {
    const parsed = approvalRequestSchema.safeParse(entry);
    if (parsed.success) approvals.push(parsed.data);
  }
  return approvals;
}

/**
 * Latest state per `approvalId` across the transcript, in first-seen order.
 * Later parts override earlier ones (a `PENDING_APPROVAL` request followed by
 * its `APPROVED` update collapses to one approved entry), and `messageId`
 * keeps the message that first carried the request.
 */
export function deriveApprovals(messages: readonly FlueConversationMessage[]): ApprovalRequest[] {
  const byId = new Map<string, ApprovalRequest>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isDataPartNamed(part, "approval")) continue;
      for (const approval of parseApprovals(part.data)) {
        const previous = byId.get(approval.approvalId);
        byId.set(approval.approvalId, { ...previous, ...approval, messageId: previous?.messageId ?? message.id });
      }
    }
  }
  return [...byId.values()];
}

/**
 * `TelemetryEvent`s carried by `data-telemetry` parts. A part may hold one
 * event, an array, or `{ events: [...] }` (an agent that appends to one
 * writer re-writes the whole list, since a write replaces the part). Invalid
 * events are dropped; duplicates collapse by id.
 */
export function deriveTelemetry(messages: readonly FlueConversationMessage[]): TelemetryEvent[] {
  const events: TelemetryEvent[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (isDataPartNamed(part, "telemetry")) events.push(...parseTelemetryPayload(part.data).events);
    }
  }
  return dedupeTelemetry(events);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Usage from one message's agent-authored metadata. Flue stamps nothing into
 * metadata, so this reads the common conventions: `usage` in Flue's
 * `PromptUsage` shape (`input`, `output`, `totalTokens`, `cost.total`) or
 * AI-SDK style (`inputTokens`, `outputTokens`), plus `costUsd`/`cost` and
 * `model` at either level.
 */
export function readMessageUsage(message: FlueConversationMessage): AgentUsage | undefined {
  const metadata = message.metadata;
  if (!metadata) return undefined;
  const usage = isRecord(metadata.usage) ? metadata.usage : undefined;
  const topLevelCost = finiteNumber(metadata.costUsd) ?? finiteNumber(metadata.cost);
  if (!usage && topLevelCost === undefined) return undefined;
  const inputTokens = finiteNumber(usage?.input) ?? finiteNumber(usage?.inputTokens) ?? finiteNumber(usage?.promptTokens) ?? 0;
  const outputTokens = finiteNumber(usage?.output) ?? finiteNumber(usage?.outputTokens) ?? finiteNumber(usage?.completionTokens) ?? 0;
  const totalTokens = finiteNumber(usage?.totalTokens) ?? inputTokens + outputTokens;
  const usageCost = isRecord(usage?.cost) ? finiteNumber(usage.cost.total) : finiteNumber(usage?.cost);
  const costUsd = usageCost ?? finiteNumber(usage?.costUsd) ?? topLevelCost ?? 0;
  const model = typeof metadata.model === "string" ? metadata.model : typeof usage?.model === "string" ? usage.model : undefined;
  return { inputTokens, outputTokens, totalTokens, costUsd, ...(model ? { model } : {}) };
}

/** Usage summed over every message that reports it, or `undefined` when none does. */
export function deriveUsage(messages: readonly FlueConversationMessage[]): AgentUsage | undefined {
  let total: AgentUsage | undefined;
  for (const message of messages) {
    const usage = readMessageUsage(message);
    if (!usage) continue;
    total = {
      inputTokens: (total?.inputTokens ?? 0) + usage.inputTokens,
      outputTokens: (total?.outputTokens ?? 0) + usage.outputTokens,
      totalTokens: (total?.totalTokens ?? 0) + usage.totalTokens,
      costUsd: Number(((total?.costUsd ?? 0) + usage.costUsd).toFixed(6)),
      ...(usage.model ? { model: usage.model } : total?.model ? { model: total.model } : {}),
    };
  }
  return total;
}

const openUIPayloadSchema = z.object({ response: z.string(), isStreaming: z.boolean().optional() });

/** Validates a `data-openui` payload; a bare string is treated as the response. */
export function parseOpenUIPayload(data: unknown): OpenUIPayload | undefined {
  if (typeof data === "string") return { response: data };
  const parsed = openUIPayloadSchema.safeParse(data);
  return parsed.success ? parsed.data : undefined;
}

/** One piece of assistant text: prose (markdown-lite) or an OpenUI Lang program. */
export type TextSegment = { kind: "markdown"; text: string } | { kind: "openui"; source: string; complete: boolean };

const OPENUI_FENCE = /^[ \t]*```[ \t]*(openui-lang|openui)\b[ \t]*(.*)$/i;
const ANY_FENCE = /^[ \t]*```/;
const STATEMENT_START = /^\s*\$?[A-Za-z_]\w*\s*=(?!=)/;
const PROGRAM_START = /^\s*root\s*=(?!=)/;

/**
 * Splits assistant text into prose and OpenUI Lang programs: fenced blocks
 * tagged `openui-lang`/`openui` (the inline-mode convention of
 * `library.prompt({ inlineMode: true })`), or the whole text when it is a bare
 * program starting with `root =`. An unclosed fence yields an incomplete
 * program (still streaming). Other fenced code stays in the prose.
 */
export function splitOpenUISegments(text: string): TextSegment[] {
  if (PROGRAM_START.test(text) && !text.includes("```")) return [{ kind: "openui", source: text, complete: true }];
  const segments: TextSegment[] = [];
  let prose: string[] = [];
  let program: string[] | null = null;
  let inOtherFence = false;
  const flushProse = () => {
    const joined = prose.join("\n");
    if (joined.trim()) segments.push({ kind: "markdown", text: joined });
    prose = [];
  };
  for (const line of text.split("\n")) {
    if (program) {
      if (/^[ \t]*```[ \t]*$/.test(line)) {
        segments.push({ kind: "openui", source: program.join("\n"), complete: true });
        program = null;
      } else {
        program.push(line);
      }
      continue;
    }
    if (inOtherFence) {
      prose.push(line);
      if (/^[ \t]*```[ \t]*$/.test(line)) inOtherFence = false;
      continue;
    }
    const opener = OPENUI_FENCE.exec(line);
    if (opener) {
      flushProse();
      const rest = opener[2] ?? "";
      program = STATEMENT_START.test(rest) ? [rest] : [];
      continue;
    }
    if (ANY_FENCE.test(line)) {
      const trimmed = line.trim();
      // "```ts" or "```" opens a block; "```x```" on one line does not.
      inOtherFence = !(trimmed.length > 6 && trimmed.endsWith("```"));
    }
    prose.push(line);
  }
  if (program) segments.push({ kind: "openui", source: program.join("\n"), complete: false });
  flushProse();
  return segments;
}
