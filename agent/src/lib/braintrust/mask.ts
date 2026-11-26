import { redactSensitive, type SpanData } from "@agent-starter/core";
import { redactSecrets } from "../../marketer/memory/redact.ts";
import type { ContentMode } from "./config.ts";

/**
 * The ONE masking function on the agent side (docs/observability/braintrust.md, rules 3 to 6). Every span leaves the
 * Worker for Braintrust through `maskSpan`, nothing else:
 *
 *  - secrets: the memory redactor (`src/marketer/memory/redact.ts`: keys, JWTs, private keys, credential assignments,
 *    auth headers, URL passwords, long hex), then emails, phone numbers, card-like numbers (Luhn), SSNs, IBANs and IP
 *    addresses from the shared PII redactor;
 *  - attributes (and JSON object keys inside attribute values) named like authorization, cookie, token, secret,
 *    password or api_key are dropped;
 *  - personal memory never leaves: every `<untrusted_content>` block from memory (recall, personal notes, the private
 *    entity graph, retrieval) is cut out, and the input and output of the memory tools are replaced by a placeholder
 *    (with counts for recall_memory);
 *  - content mode `metadata` keeps only an allowlist of attributes (model, tokens, cost, latency, tool names,
 *    outcomes, ids, scores): no prompt, completion, tool input or output, payload, reasoning or error text.
 *
 * Identity attributes (tenant, actor, conversation, run ids) are opaque ids: they skip the number-shaped PII rules
 * (a UUID is not a phone number) but an email is still replaced.
 */

export const MEMORY_PLACEHOLDER = "[personal memory omitted]";
export const MEMORY_TOOL_PLACEHOLDER = "[memory tool content omitted]";

/** Tools whose arguments or results carry personal or account memory. Their content never reaches a span. */
export const MEMORY_TOOLS: ReadonlySet<string> = new Set(["recall_memory", "fact_history", "remember_note", "search_notes", "forget_note", "remember_fact", "recall_entity", "remember"]);

/** `<untrusted_content source="...">` sources that hold memory a person or workspace gave Marketer. */
const MEMORY_SOURCE = String.raw`(?:memory(?::[^"\\]*)?|retrieval|relational-memory)`;
// Matches the plain form and the JSON-escaped form (\"memory\"). A block cut by attribute truncation (no closing tag)
// is dropped to the end of the string.
const MEMORY_BLOCK = new RegExp(String.raw`<untrusted_content source=\\?"${MEMORY_SOURCE}\\?">[\s\S]*?(?:<\/untrusted_content>|$)`, "g");

const PII_KINDS = ["email", "credit_card", "ssn", "iban", "phone", "ip_address"] as const;

/** Key segments that mark a secret-bearing attribute or JSON key. */
const SECRET_SEGMENTS = new Set(["authorization", "cookie", "cookies", "token", "secret", "secrets", "password", "passwd", "passphrase", "apikey", "credential", "credentials"]);

/**
 * Is this attribute / JSON key named like a secret? Matched on its segments (split on `.`, `_`, `-`, camelCase), so
 * `x-api-key`, `auth_token` and `clientSecret` are dropped while `gen_ai.usage.input_tokens` and `max_tokens` stay.
 */
export function isSecretKey(key: string): boolean {
  const segments = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i] as string;
    if (SECRET_SEGMENTS.has(s)) return true;
    if (s === "api" && segments[i + 1] === "key") return true;
    if (s === "private" && segments[i + 1] === "key") return true;
  }
  return false;
}

/** Cut every personal-memory block out of a text. */
export function stripPersonalMemory(text: string): string {
  return text.includes("untrusted_content") ? text.replace(MEMORY_BLOCK, MEMORY_PLACEHOLDER) : text;
}

/** Secrets, then PII, in free text (memory blocks are removed first). */
export function maskText(text: string): string {
  if (!text) return text;
  const withoutMemory = stripPersonalMemory(text);
  return redactSensitive(redactSecrets(withoutMemory), { kinds: [...PII_KINDS] }).text;
}

/** Opaque ids: only emails are replaced (a person id may be email-shaped in dev tooling; rule 6: never an email). */
export function maskId(text: string): string {
  return redactSensitive(text, { kinds: ["email"] }).text;
}

// `"api_key": "..."` and friends inside JSON text we could not parse (cut by truncation).
const JSON_SECRET_PAIR = /"([A-Za-z0-9_.-]*(?:authorization|cookie|token|secret|password|passwd|api[_-]?key|apikey|credential)[A-Za-z0-9_.-]*)"\s*:\s*"(?:[^"\\]|\\.)*"/gi;
const JSON_SECRET_PAIR_ESCAPED = /\\"([A-Za-z0-9_.-]*(?:authorization|cookie|token|secret|password|passwd|api[_-]?key|apikey|credential)[A-Za-z0-9_.-]*)\\"\s*:\s*\\"(?:[^"\\]|\\[^"])*\\"/gi;
const MEMORY_TOOL_REFERENCE = new RegExp(String.raw`\\?"(?:name|toolName|tool)\\?"\s*:\s*\\?"(?:${[...MEMORY_TOOLS].join("|")})\\?"`);

function maskLooseText(text: string): string {
  // Unparseable structured text that mentions a memory tool call or result: we cannot tell its fields apart, so none of it goes.
  if (MEMORY_TOOL_REFERENCE.test(text)) return MEMORY_TOOL_PLACEHOLDER;
  const pairs = text
    .replace(JSON_SECRET_PAIR, (match, key: string) => (isSecretKey(key) ? `"${key}":"[REDACTED]"` : match))
    .replace(JSON_SECRET_PAIR_ESCAPED, (match, key: string) => (isSecretKey(key) ? `\\"${key}\\":\\"[REDACTED]\\"` : match));
  return maskText(pairs);
}

const MAX_PARSE_CHARS = 200_000;

function looksLikeJson(text: string): boolean {
  const t = text.trimStart();
  return (t.startsWith("{") || t.startsWith("[")) && text.length <= MAX_PARSE_CHARS;
}

/** Counts that replace recall_memory's result (rule 5: counts and scope kind only). */
function memoryResultSummary(value: unknown): string {
  const parsed = typeof value === "string" && looksLikeJson(value) ? safeParse(value) : value;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const v = parsed as Record<string, unknown>;
    const facts = Array.isArray(v.facts) ? v.facts.length : undefined;
    const recalled = Array.isArray(v.recalled) ? (v.recalled as Array<{ scope?: unknown }>) : undefined;
    if (facts !== undefined || recalled !== undefined) {
      const personal = recalled?.filter((r) => r && r.scope === "personal").length ?? 0;
      const team = recalled?.filter((r) => r && r.scope === "team").length ?? 0;
      return JSON.stringify({ omitted: "memory", facts: facts ?? 0, recalled: { personal, team } });
    }
  }
  return MEMORY_TOOL_PLACEHOLDER;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Deep-mask a structured value: secret-named keys dropped, strings masked (JSON strings parsed and masked inside),
 * and the content of any memory tool call or result (an object whose `name` / `toolName` is a memory tool) replaced.
 */
export function maskValue(value: unknown, depth = 0): unknown {
  if (depth > 32) return "[omitted: nested too deep]";
  if (typeof value === "string") return maskString(value, depth + 1);
  if (Array.isArray(value)) return value.map((v) => maskValue(v, depth + 1));
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const toolName = typeof obj.name === "string" ? obj.name : typeof obj.toolName === "string" ? obj.toolName : typeof obj.tool === "string" ? obj.tool : undefined;
    const memoryTool = toolName !== undefined && MEMORY_TOOLS.has(toolName);
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(obj)) {
      if (isSecretKey(key)) continue;
      if (memoryTool && (key === "content" || key === "arguments" || key === "args" || key === "input" || key === "result" || key === "output")) {
        out[key] = key === "content" || key === "result" || key === "output" ? (toolName === "recall_memory" ? memoryResultSummary(v) : MEMORY_TOOL_PLACEHOLDER) : MEMORY_TOOL_PLACEHOLDER;
        continue;
      }
      out[key] = maskValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Mask one string: JSON is parsed and masked structurally, anything else as text. */
export function maskString(text: string, depth = 0): string {
  if (looksLikeJson(text)) {
    const parsed = safeParse(text);
    if (parsed !== undefined && parsed !== null && typeof parsed === "object") return JSON.stringify(maskValue(parsed, depth));
  }
  return maskLooseText(text);
}

/* ------------------------------------------------------------------ *
 * Spans
 * ------------------------------------------------------------------ */

/** Identity attributes: opaque ids, emails replaced only. */
export const IDENTITY_KEYS: ReadonlySet<string> = new Set(["agent", "tenant_id", "actor_id", "conversation_id", "role", "env", "release", "agent.tenant_id", "agent.run_id", "agent.name", "flue.submission_id", "gen_ai.tool.call.id"]);

/** What `metadata` mode keeps (no prompt or output text at all). */
const METADATA_KEYS: ReadonlySet<string> = new Set([
  ...IDENTITY_KEYS,
  "gen_ai.system",
  "gen_ai.operation.name",
  "gen_ai.request.model",
  "gen_ai.response.model",
  "gen_ai.request.reasoning_level",
  "gen_ai.request.max_tokens",
  "gen_ai.response.finish_reasons",
  "gen_ai.tool.name",
  "agent.cost_usd",
  "agent.step",
  "agent.turn",
  "agent.risk_tier",
  "agent.span_kind",
  "agent.semantic_cache_hit",
  "flue.submission_outcome",
  "flue.turn_purpose",
  "sandbox.exit_code",
  "error.code",
  "braintrust.scores",
  "braintrust.span_attributes",
  "braintrust.metrics",
  "marketer.content_mode",
]);
const METADATA_PREFIXES = ["gen_ai.usage.", "agent.compaction.", "decision."];

export function keptInMetadataMode(key: string): boolean {
  return METADATA_KEYS.has(key) || METADATA_PREFIXES.some((p) => key.startsWith(p));
}

type Attrs = SpanData["attributes"];

/** Attributes holding a tool's input or output (replaced wholesale for memory tools). */
const TOOL_IO_KEYS = new Set(["gen_ai.tool.arguments", "gen_ai.tool.result", "sandbox.code", "sandbox.output"]);

function maskAttributes(attributes: Attrs, mode: ContentMode, memoryTool: string | undefined): Attrs {
  const out: Attrs = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || isSecretKey(key)) continue;
    if (mode === "metadata" && !keptInMetadataMode(key)) continue;
    if (typeof value !== "string") {
      out[key] = value;
      continue;
    }
    if (IDENTITY_KEYS.has(key)) {
      out[key] = maskId(value);
      continue;
    }
    if (memoryTool && TOOL_IO_KEYS.has(key)) {
      out[key] = key === "gen_ai.tool.result" && memoryTool === "recall_memory" ? memoryResultSummary(value) : MEMORY_TOOL_PLACEHOLDER;
      continue;
    }
    out[key] = maskString(value);
  }
  return out;
}

/**
 * The masked copy of a span for export in `mode`. Never mutates the input. In `metadata` mode the status message (it
 * can carry tool output) and event attributes are dropped too.
 */
export function maskSpan(span: SpanData, mode: ContentMode): SpanData {
  const toolName = typeof span.attributes["gen_ai.tool.name"] === "string" ? (span.attributes["gen_ai.tool.name"] as string) : undefined;
  const memoryTool = toolName && MEMORY_TOOLS.has(toolName) ? toolName : undefined;
  const masked: SpanData = {
    ...span,
    attributes: maskAttributes(span.attributes, mode, memoryTool),
    events: span.events.map((e) => ({ name: e.name, time: e.time, ...(mode === "redacted" && e.attributes ? { attributes: maskAttributes(e.attributes, mode, memoryTool) } : {}) })),
  };
  delete masked.statusMessage;
  if (mode === "redacted" && span.statusMessage) masked.statusMessage = memoryTool ? MEMORY_TOOL_PLACEHOLDER : maskString(span.statusMessage).slice(0, 500);
  return masked;
}
