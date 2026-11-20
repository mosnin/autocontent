import { type StandardSchemaV1, toJsonSchema } from "@agent-starter/core";
import * as v from "valibot";

type Json = Record<string, unknown>;
type AnySchema = v.GenericSchema;

const OBJECT_TYPES = new Set(["object", "strict_object", "loose_object", "object_with_rest"]);

/** The bridged Flue input for one tool, plus how to turn Flue's parsed data back into the tool's own argument shape. */
export interface FlueToolInput {
  input: v.GenericSchema<Record<string, unknown>, unknown>;
  /** True when the tool's schema is not an object and was wrapped as `{ value }` (Flue requires top-level objects). */
  wrapped: boolean;
  /** Flue `ctx.data` → arguments the original schema (and the core executor) expects. */
  unwrap(data: unknown): unknown;
}

function isValibotObject(schema: StandardSchemaV1): boolean {
  return OBJECT_TYPES.has(String((schema as unknown as { type?: string }).type ?? ""));
}

/**
 * Bridge any Standard Schema tool input into what Flue accepts: a top-level
 * Valibot object. Zod (and other vendors) are converted through JSON Schema;
 * non-object schemas (`z.string()`, `z.array(...)`, a Valibot union, ...) are
 * wrapped as `{ value }` and `unwrap` hands the inner value back, so the core
 * ToolExecutor re-validates exactly what the original schema describes.
 */
export function toFlueToolInput(schema: StandardSchemaV1): FlueToolInput {
  if (schema["~standard"].vendor === "valibot") {
    if (isValibotObject(schema)) return { input: schema as unknown as FlueToolInput["input"], wrapped: false, unwrap: (data) => data };
    return { input: v.object({ value: schema as unknown as AnySchema }) as unknown as FlueToolInput["input"], wrapped: true, unwrap: unwrapValue };
  }
  const json = toJsonSchema(schema);
  const converted = fromJsonSchema(json);
  if (json.type !== "object") return { input: v.object({ value: converted }) as unknown as FlueToolInput["input"], wrapped: true, unwrap: unwrapValue };
  return { input: converted as unknown as FlueToolInput["input"], wrapped: false, unwrap: (data) => data };
}

function unwrapValue(data: unknown): unknown {
  return data && typeof data === "object" && !Array.isArray(data) && "value" in data ? (data as { value: unknown }).value : data;
}

/**
 * Flue tools require Valibot input schemas (they are converted to JSON Schema for
 * the model). Tools authored with zod — including every tool in
 * @agent-starter/integrations — are bridged by converting their JSON Schema into
 * an equivalent Valibot schema. The original schema remains authoritative: the
 * core ToolExecutor re-validates every call with it. Non-object schemas come
 * back wrapped as `{ value }`: use `toFlueToolInput()` to get the matching
 * `unwrap` (useAgentStarter does).
 */
export function toFlueInputSchema(schema: StandardSchemaV1): v.GenericSchema<Record<string, unknown>, unknown> {
  return toFlueToolInput(schema).input;
}

/**
 * Lenient twin of a tool's input for argument healing (R-TOOL-07): the same
 * property names, JSON types and descriptions for the model, but every
 * property optional and constraints (required, enum, pattern, bounds, formats)
 * moved into the description. Malformed calls then reach the core executor,
 * whose ArgumentHealer repairs/coerces (optionally with a cheap model) and
 * validates against the original schema before anything executes.
 */
export function toLenientFlueToolInput(schema: StandardSchemaV1): FlueToolInput {
  let json: Json;
  try {
    json = toJsonSchema(schema);
  } catch {
    return toFlueToolInput(schema);
  }
  if (json.type !== "object") return { input: v.looseObject({ value: v.optional(lenient(json, true)) }) as unknown as FlueToolInput["input"], wrapped: true, unwrap: unwrapValue };
  return { input: lenientObject(json) as unknown as FlueToolInput["input"], wrapped: false, unwrap: (data) => data };
}

/** Name of the optional self-reported confidence field added to non-LOW tools when `confidence: true`. */
export const CONFIDENCE_FIELD = "_confidence";

/**
 * Add an optional `_confidence` (0..1) property to an object input so the model
 * can self-report certainty for a risky action; the autonomy gateway pauses for
 * a human when it is below the tenant threshold (R-TOOL-05). Non-object or
 * rest-object inputs are returned unchanged.
 */
export function withConfidenceField(bridged: FlueToolInput): FlueToolInput {
  const schema = bridged.input as unknown as { type?: string; entries?: Record<string, AnySchema> };
  if (!schema.entries || !["object", "strict_object", "loose_object"].includes(String(schema.type))) return bridged;
  const entries = { ...schema.entries, [CONFIDENCE_FIELD]: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1), v.description("Your confidence (0-1) that this exact action is correct and intended. Be honest: low values pause for a human."))) };
  const input = schema.type === "strict_object" ? v.strictObject(entries) : schema.type === "loose_object" ? v.looseObject(entries) : v.object(entries);
  return {
    input: input as unknown as FlueToolInput["input"],
    wrapped: bridged.wrapped,
    unwrap: (data) => {
      if (!data || typeof data !== "object" || Array.isArray(data)) return bridged.unwrap(data);
      const { [CONFIDENCE_FIELD]: _drop, ...rest } = data as Record<string, unknown>;
      return bridged.unwrap(rest);
    },
  };
}

/** The self-reported confidence in Flue tool data, if any. */
export function confidenceOf(data: unknown): number | undefined {
  const value = data && typeof data === "object" ? (data as Record<string, unknown>)[CONFIDENCE_FIELD] : undefined;
  return typeof value === "number" && value >= 0 && value <= 1 ? value : undefined;
}

function constraintHints(node: Json, required: boolean): string[] {
  const hints: string[] = [];
  if (required) hints.push("required");
  if (Array.isArray(node.enum)) hints.push(`one of: ${(node.enum as unknown[]).map((e) => JSON.stringify(e)).join(", ")}`);
  if ("const" in node) hints.push(`must be ${JSON.stringify(node.const)}`);
  if (typeof node.pattern === "string") hints.push(`pattern ${node.pattern}`);
  if (typeof node.format === "string") hints.push(`format ${node.format}`);
  for (const key of ["minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minItems", "maxItems"]) {
    if (typeof node[key] === "number") hints.push(`${key} ${node[key] as number}`);
  }
  return hints;
}

function withHints(schema: AnySchema, node: Json, required: boolean): AnySchema {
  const hints = constraintHints(node, required);
  const text = [typeof node.description === "string" ? node.description : "", hints.length ? `(${hints.join("; ")})` : ""].filter(Boolean).join(" ");
  return text ? (v.pipe(schema, v.description(text)) as AnySchema) : schema;
}

function lenientObject(node: Json): AnySchema {
  const properties = (node.properties ?? {}) as Record<string, Json>;
  const required = new Set((node.required ?? []) as string[]);
  const entries: Record<string, AnySchema> = {};
  for (const [key, child] of Object.entries(properties)) entries[key] = v.optional(lenient(child, required.has(key))) as AnySchema;
  return v.looseObject(entries) as AnySchema;
}

function lenient(node: Json, required: boolean): AnySchema {
  const type = Array.isArray(node.type) ? (node.type as string[]).find((t) => t !== "null") : (node.type as string | undefined);
  let schema: AnySchema;
  switch (type) {
    case "string":
      schema = v.string() as AnySchema;
      break;
    case "integer":
    case "number":
      schema = v.number() as AnySchema;
      break;
    case "boolean":
      schema = v.boolean() as AnySchema;
      break;
    case "array":
      schema = v.array(node.items && typeof node.items === "object" ? lenient(node.items as Json, false) : (v.unknown() as AnySchema)) as AnySchema;
      break;
    case "object":
      schema = lenientObject(node);
      break;
    default:
      schema = v.unknown() as AnySchema;
  }
  // Nullable everywhere: models often send null for optional values; the executor drops/repairs them.
  return withHints(v.nullable(schema) as AnySchema, node, required);
}

function described(schema: AnySchema, node: Json): AnySchema {
  return typeof node.description === "string" ? (v.pipe(schema, v.description(node.description)) as AnySchema) : schema;
}

export function fromJsonSchema(node: Json): AnySchema {
  const variants = (node.anyOf ?? node.oneOf) as Json[] | undefined;
  if (Array.isArray(variants) && variants.length) {
    const nonNull = variants.filter((s) => s.type !== "null");
    const inner = nonNull.length === 1 ? fromJsonSchema(nonNull[0] as Json) : (v.union(nonNull.map((s) => fromJsonSchema(s)) as [AnySchema, ...AnySchema[]]) as AnySchema);
    return described(nonNull.length < variants.length ? (v.nullable(inner) as AnySchema) : inner, node);
  }
  if (Array.isArray(node.enum) && node.enum.length) {
    const values = node.enum as Array<string | number | boolean | null>;
    if (values.every((e) => typeof e === "string")) return described(v.picklist(values as [string, ...string[]]) as AnySchema, node);
    return described(v.union(values.map((e) => v.literal(e as string | number | boolean)) as unknown as [AnySchema, ...AnySchema[]]) as AnySchema, node);
  }
  if ("const" in node) return described(v.literal(node.const as string | number | boolean) as AnySchema, node);
  const type = Array.isArray(node.type) ? (node.type as string[]).find((t) => t !== "null") : (node.type as string | undefined);
  const nullable = Array.isArray(node.type) && (node.type as string[]).includes("null");
  let schema: AnySchema;
  switch (type) {
    case "string": {
      const pipes: unknown[] = [];
      if (typeof node.minLength === "number") pipes.push(v.minLength(node.minLength));
      if (typeof node.maxLength === "number") pipes.push(v.maxLength(node.maxLength));
      if (typeof node.pattern === "string") pipes.push(v.regex(new RegExp(node.pattern)));
      if (node.format === "email") pipes.push(v.email());
      if (node.format === "uri" || node.format === "url") pipes.push(v.url());
      if (node.format === "date-time") pipes.push(v.isoTimestamp());
      schema = (pipes.length ? v.pipe(v.string(), ...(pipes as [])) : v.string()) as AnySchema;
      break;
    }
    case "integer":
    case "number": {
      const pipes: unknown[] = type === "integer" ? [v.integer()] : [];
      if (typeof node.minimum === "number") pipes.push(v.minValue(node.minimum));
      if (typeof node.maximum === "number") pipes.push(v.maxValue(node.maximum));
      if (typeof node.exclusiveMinimum === "number") pipes.push(v.gtValue(node.exclusiveMinimum));
      if (typeof node.exclusiveMaximum === "number") pipes.push(v.ltValue(node.exclusiveMaximum));
      schema = (pipes.length ? v.pipe(v.number(), ...(pipes as [])) : v.number()) as AnySchema;
      break;
    }
    case "boolean":
      schema = v.boolean() as AnySchema;
      break;
    case "array": {
      const items = node.items && typeof node.items === "object" ? fromJsonSchema(node.items as Json) : (v.unknown() as AnySchema);
      const pipes: unknown[] = [];
      if (typeof node.minItems === "number") pipes.push(v.minLength(node.minItems));
      if (typeof node.maxItems === "number") pipes.push(v.maxLength(node.maxItems));
      schema = (pipes.length ? v.pipe(v.array(items), ...(pipes as [])) : v.array(items)) as AnySchema;
      break;
    }
    case "object": {
      const properties = (node.properties ?? {}) as Record<string, Json>;
      const required = new Set((node.required ?? []) as string[]);
      const entries: Record<string, AnySchema> = {};
      for (const [key, child] of Object.entries(properties)) {
        const inner = fromJsonSchema(child);
        entries[key] = required.has(key) ? inner : "default" in child ? (v.optional(inner, child.default as never) as AnySchema) : (v.optional(inner) as AnySchema);
      }
      if (Object.keys(properties).length === 0 && node.additionalProperties && typeof node.additionalProperties === "object") {
        schema = v.record(v.string(), fromJsonSchema(node.additionalProperties as Json)) as AnySchema;
      } else {
        schema = (node.additionalProperties === false ? v.strictObject(entries) : v.object(entries)) as AnySchema;
      }
      break;
    }
    default:
      schema = v.unknown() as AnySchema;
  }
  return described(nullable ? (v.nullable(schema) as AnySchema) : schema, node);
}
