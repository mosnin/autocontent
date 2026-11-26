import { AgentError } from "../errors.ts";
import { completeText } from "../models/structured.ts";
import type { ModelProvider } from "../models/types.ts";
import { extractJsonBlock, safeJsonParse } from "../util/text.ts";
import { type StandardSchemaV1, toJsonSchema, validateStandard } from "./schema.ts";

/**
 * Programmatic JSON repair for common model mistakes: markdown fences, prose
 * around the payload, single quotes, unquoted keys, Python literals, trailing
 * commas, truncated strings and unbalanced brackets (closed in correct order).
 */
export function repairJsonText(raw: string): string {
  const source = (extractJsonBlock(raw) ?? raw).trim();
  let out = "";
  const stack: string[] = [];
  let quote: '"' | "'" | null = null;
  let escaped = false;

  const lastSignificant = () => {
    for (let i = out.length - 1; i >= 0; i--) {
      const ch = out[i] as string;
      if (!/\s/.test(ch)) return ch;
    }
    return "";
  };
  const trimTrailingComma = () => {
    const trimmed = out.replace(/\s+$/, "");
    if (trimmed.endsWith(",")) out = trimmed.slice(0, -1);
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i] as string;
    if (quote) {
      if (escaped) {
        // `\'` is valid inside single-quoted JS strings but not JSON: drop the backslash.
        out += ch === "'" ? "'" : `\\${ch}`;
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        out += '"';
        quote = null;
      } else if (ch === '"' && quote === "'") {
        out += '\\"';
      } else if (ch === "\n") {
        out += "\\n";
      } else {
        out += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += '"';
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch === "{" ? "}" : "]");
      out += ch;
      continue;
    }
    if (ch === "}" || ch === "]") {
      trimTrailingComma();
      if (stack[stack.length - 1] === ch) stack.pop();
      out += ch;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < source.length && /[A-Za-z0-9_$-]/.test(source[j] as string)) j++;
      const word = source.slice(i, j);
      let k = j;
      while (k < source.length && /\s/.test(source[k] as string)) k++;
      const prev = lastSignificant();
      if (source[k] === ":" && (prev === "{" || prev === ",")) {
        out += JSON.stringify(word);
      } else if (word === "True" || word === "False") {
        out += word.toLowerCase();
      } else if (word === "None" || word === "undefined") {
        out += "null";
      } else {
        out += word;
      }
      i = j - 1;
      continue;
    }
    out += ch;
  }

  if (quote) out += '"';
  out = out.replace(/\s+$/, "");
  if (out.endsWith(":")) out += " null";
  trimTrailingComma();
  while (stack.length) {
    trimTrailingComma();
    out += stack.pop();
  }
  return out;
}

/** Coerce scalar type mismatches using the tool's JSON Schema (e.g. "5" → 5, "true" → true, x → [x]). */
export function coerceToJsonSchema(value: unknown, schema: Record<string, unknown> | undefined): unknown {
  if (!schema || typeof schema !== "object") return value;
  const anyOf = (schema.anyOf ?? schema.oneOf) as Record<string, unknown>[] | undefined;
  if (Array.isArray(anyOf) && anyOf.length > 0) return coerceToJsonSchema(value, anyOf.find((s) => s.type !== "null") ?? anyOf[0]);
  const type = Array.isArray(schema.type) ? (schema.type as string[]).find((t) => t !== "null") : (schema.type as string | undefined);
  switch (type) {
    case "number":
    case "integer":
      if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return type === "integer" ? Math.trunc(Number(value)) : Number(value);
      return value;
    case "boolean":
      if (value === "true" || value === 1 || value === "1") return true;
      if (value === "false" || value === 0 || value === "0") return false;
      return value;
    case "string":
      if (typeof value === "number" || typeof value === "boolean") return String(value);
      return value;
    case "array": {
      const items = schema.items as Record<string, unknown> | undefined;
      const arr = Array.isArray(value) ? value : value === undefined || value === null ? value : typeof value === "string" && value.trim().startsWith("[") ? safeArray(value) : [value];
      return Array.isArray(arr) ? arr.map((v) => coerceToJsonSchema(v, items)) : arr;
    }
    case "object": {
      let obj = value;
      if (typeof obj === "string" && obj.trim().startsWith("{")) {
        const parsed = safeJsonParse(repairJsonText(obj));
        if (parsed.ok) obj = parsed.value;
      }
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
      const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) out[k] = k in properties ? coerceToJsonSchema(v, properties[k]) : v;
      return out;
    }
    default:
      return value;
  }
}

function safeArray(text: string): unknown {
  const parsed = safeJsonParse(repairJsonText(text));
  return parsed.ok ? parsed.value : [text];
}

export interface HealResult<T> {
  value: T;
  strategy: "parsed" | "repaired" | "coerced" | "model-repaired";
}

export interface ArgumentHealerOptions {
  /** Small, cheap model (Workers AI) used only when programmatic repair fails. */
  repairModel?: ModelProvider;
}

/**
 * Sits between the model's raw tool-call text and strict schema validation.
 * Cheap programmatic strategies run first; a tiny edge model is consulted only
 * as a last resort. Unrecoverable payloads raise ARGUMENT_CORRUPTION_UNRECOVERABLE
 * with the validation issues so the agent loop can feed them back to the model.
 */
export class ArgumentHealer {
  constructor(private readonly options: ArgumentHealerOptions = {}) {}

  async heal<S extends StandardSchemaV1>(toolName: string, raw: string | unknown, schema: S): Promise<HealResult<import("./schema.ts").InferOutput<S>>> {
    let jsonSchema: Record<string, unknown> | undefined;
    try {
      jsonSchema = toJsonSchema(schema);
    } catch {
      jsonSchema = undefined;
    }

    let candidate: unknown;
    let strategy: HealResult<unknown>["strategy"] = "parsed";
    if (typeof raw === "string") {
      const direct = safeJsonParse(raw.trim() === "" ? "{}" : raw);
      if (direct.ok) candidate = direct.value;
      else {
        const repaired = safeJsonParse(repairJsonText(raw));
        if (repaired.ok) {
          candidate = repaired.value;
          strategy = "repaired";
        }
      }
    } else {
      candidate = raw;
    }

    let lastIssues: string[] = ["arguments were not valid JSON"];
    if (candidate !== undefined) {
      const first = await validateStandard(schema, candidate);
      if (first.ok) return { value: first.value, strategy } as HealResult<import("./schema.ts").InferOutput<S>>;
      const coerced = coerceToJsonSchema(candidate, jsonSchema);
      const second = await validateStandard(schema, coerced);
      if (second.ok) return { value: second.value, strategy: "coerced" } as HealResult<import("./schema.ts").InferOutput<S>>;
      lastIssues = second.issues;
    }

    if (this.options.repairModel) {
      const { text } = await completeText(this.options.repairModel, {
        system: "You are a JSON syntax healer. Output only a single valid JSON object that satisfies the provided schema. No markdown, no commentary.",
        prompt: `Target JSON Schema for tool "${toolName}":\n${JSON.stringify(jsonSchema ?? {})}\n\nValidation problems:\n- ${lastIssues.join("\n- ")}\n\nMalformed arguments:\n${typeof raw === "string" ? raw : JSON.stringify(raw)}`,
        temperature: 0,
        maxOutputTokens: 1024,
      });
      const parsed = safeJsonParse(repairJsonText(text));
      if (parsed.ok) {
        const third = await validateStandard(schema, coerceToJsonSchema(parsed.value, jsonSchema));
        if (third.ok) return { value: third.value, strategy: "model-repaired" } as HealResult<import("./schema.ts").InferOutput<S>>;
        lastIssues = third.issues;
      }
    }

    throw new AgentError("ARGUMENT_CORRUPTION_UNRECOVERABLE", `Arguments for "${toolName}" could not be repaired: ${lastIssues.join("; ")}`, {
      details: { toolName, issues: lastIssues },
    });
  }
}
