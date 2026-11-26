import { registerJsonSchemaConverter, type StandardResult, type StandardSchemaV1 } from "@agent-starter/core";

/**
 * Standard-Schema adapter over a plain JSON Schema object (as published by
 * Composio, MCP servers and OpenAPI specs). It validates the subset that
 * matters for tool calls (type, required, properties, items, enum, const,
 * anyOf/oneOf/allOf, string/array length and numeric bounds) and keeps the
 * original schema so `toJsonSchema()` hands the model exactly what the vendor
 * published.
 */
export type JsonSchemaObject = Record<string, unknown>;

export const JSON_SCHEMA_VENDOR = "json-schema";

export interface JsonSchemaStandard extends StandardSchemaV1<Record<string, unknown>, Record<string, unknown>> {
  readonly jsonSchema: JsonSchemaObject;
}

export interface JsonSchemaStandardOptions {
  /**
   * Treat `null` for a property that is not `required` as "omitted" and drop it
   * from the validated value. Models routinely send `null` for optional
   * parameters; vendors then reject the literal null. Default true.
   */
  dropNullOptionals?: boolean;
  /** Maximum nesting depth validated (guards against pathological schemas). Default 32. */
  maxDepth?: number;
}

type Issue = { message: string; path: ReadonlyArray<PropertyKey> };

let converterRegistered = false;

function ensureConverterRegistered(): void {
  if (converterRegistered) return;
  converterRegistered = true;
  registerJsonSchemaConverter((schema) => {
    if (schema["~standard"].vendor !== JSON_SCHEMA_VENDOR) return undefined;
    const candidate = (schema as Partial<JsonSchemaStandard>).jsonSchema;
    return candidate && typeof candidate === "object" ? candidate : undefined;
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeOfJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  const actual = typeOfJson(value);
  if (type === "number") return actual === "number" || actual === "integer";
  return actual === type;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  const ak = Object.keys(a as Record<string, unknown>);
  const bk = Object.keys(b as Record<string, unknown>);
  return ak.length === bk.length && ak.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function resolveRef(ref: string, root: JsonSchemaObject): JsonSchemaObject | undefined {
  if (!ref.startsWith("#/")) return undefined;
  let current: unknown = root;
  for (const raw of ref.slice(2).split("/")) {
    const part = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isPlainObject(current)) return undefined;
    current = current[part];
  }
  return isPlainObject(current) ? current : undefined;
}

class Validator {
  readonly issues: Issue[] = [];

  constructor(
    private readonly root: JsonSchemaObject,
    private readonly options: Required<JsonSchemaStandardOptions>,
  ) {}

  /** Returns the (possibly cleaned) value. Issues are collected on `this.issues`. */
  validate(schemaInput: unknown, value: unknown, path: PropertyKey[], depth: number): unknown {
    if (depth > this.options.maxDepth) return value;
    if (schemaInput === true || schemaInput === undefined) return value;
    if (schemaInput === false) {
      this.issues.push({ message: "No value is allowed here", path });
      return value;
    }
    if (!isPlainObject(schemaInput)) return value;
    let schema = schemaInput;
    if (typeof schema.$ref === "string") {
      const resolved = resolveRef(schema.$ref, this.root);
      if (resolved) schema = { ...resolved, ...Object.fromEntries(Object.entries(schema).filter(([k]) => k !== "$ref")) };
    }

    if (Array.isArray(schema.allOf)) {
      for (const sub of schema.allOf) value = this.validate(sub, value, path, depth + 1);
    }
    for (const key of ["anyOf", "oneOf"] as const) {
      const branches = schema[key];
      if (!Array.isArray(branches) || branches.length === 0) continue;
      let matched = false;
      for (const branch of branches) {
        const probe = new Validator(this.root, this.options);
        const cleaned = probe.validate(branch, value, path, depth + 1);
        if (probe.issues.length === 0) {
          value = cleaned;
          matched = true;
          break;
        }
      }
      if (!matched) this.issues.push({ message: `Value does not match any allowed schema (${key})`, path });
    }

    const nullable = schema.nullable === true;
    if (value === null && nullable) return value;

    const rawType = schema.type;
    const types = Array.isArray(rawType) ? rawType.filter((t): t is string => typeof t === "string") : typeof rawType === "string" ? [rawType] : [];
    if (types.length > 0 && !types.some((t) => matchesType(value, t))) {
      this.issues.push({ message: `Expected ${types.join(" | ")}, received ${typeOfJson(value)}`, path });
      return value;
    }

    if (Array.isArray(schema.enum) && !schema.enum.some((option) => deepEqual(option, value))) {
      this.issues.push({ message: `Expected one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`, path });
    }
    if ("const" in schema && !deepEqual(schema.const, value)) {
      this.issues.push({ message: `Expected constant ${JSON.stringify(schema.const)}`, path });
    }

    if (typeof value === "string") {
      if (typeof schema.minLength === "number" && value.length < schema.minLength) this.issues.push({ message: `Must be at least ${schema.minLength} characters`, path });
      if (typeof schema.maxLength === "number" && value.length > schema.maxLength) this.issues.push({ message: `Must be at most ${schema.maxLength} characters`, path });
      if (typeof schema.pattern === "string") {
        try {
          if (!new RegExp(schema.pattern, "u").test(value)) this.issues.push({ message: `Must match pattern ${schema.pattern}`, path });
        } catch {
          // Patterns using syntax JS cannot compile are left to the vendor to enforce.
        }
      }
    }

    if (typeof value === "number") {
      if (typeof schema.minimum === "number" && value < schema.minimum) this.issues.push({ message: `Must be >= ${schema.minimum}`, path });
      if (typeof schema.maximum === "number" && value > schema.maximum) this.issues.push({ message: `Must be <= ${schema.maximum}`, path });
      if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) this.issues.push({ message: `Must be > ${schema.exclusiveMinimum}`, path });
      if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) this.issues.push({ message: `Must be < ${schema.exclusiveMaximum}`, path });
    }

    if (Array.isArray(value)) {
      if (typeof schema.minItems === "number" && value.length < schema.minItems) this.issues.push({ message: `Must contain at least ${schema.minItems} items`, path });
      if (typeof schema.maxItems === "number" && value.length > schema.maxItems) this.issues.push({ message: `Must contain at most ${schema.maxItems} items`, path });
      if (schema.items !== undefined && !Array.isArray(schema.items)) {
        return value.map((item, index) => this.validate(schema.items, item, [...path, index], depth + 1));
      }
      return value;
    }

    if (isPlainObject(value)) {
      const properties = isPlainObject(schema.properties) ? schema.properties : {};
      const required = Array.isArray(schema.required) ? schema.required.filter((r): r is string => typeof r === "string") : [];
      const out: Record<string, unknown> = {};
      for (const name of required) {
        if (!(name in value) || value[name] === undefined) this.issues.push({ message: "Required", path: [...path, name] });
      }
      for (const [key, child] of Object.entries(value)) {
        if (child === undefined) continue;
        const propSchema = properties[key];
        if (child === null && this.options.dropNullOptionals && !required.includes(key)) {
          const propTypes = isPlainObject(propSchema) ? propSchema.type : undefined;
          const allowsNull = propTypes === "null" || (Array.isArray(propTypes) && propTypes.includes("null")) || (isPlainObject(propSchema) && propSchema.nullable === true);
          if (!allowsNull) continue;
        }
        if (propSchema !== undefined) {
          out[key] = this.validate(propSchema, child, [...path, key], depth + 1);
        } else if (schema.additionalProperties === false) {
          this.issues.push({ message: `Unknown property "${key}"`, path: [...path, key] });
        } else {
          out[key] = isPlainObject(schema.additionalProperties) ? this.validate(schema.additionalProperties, child, [...path, key], depth + 1) : child;
        }
      }
      return out;
    }
    return value;
  }
}

/**
 * Wrap a JSON Schema as a Standard Schema. Registers (once) a converter with
 * core's `toJsonSchema()` so the schema the model sees is the original one.
 */
export function jsonSchemaStandard(jsonSchema: JsonSchemaObject, options: JsonSchemaStandardOptions = {}): JsonSchemaStandard {
  ensureConverterRegistered();
  const resolved: Required<JsonSchemaStandardOptions> = { dropNullOptionals: options.dropNullOptionals ?? true, maxDepth: options.maxDepth ?? 32 };
  const schema: JsonSchemaObject = { type: "object", properties: {}, ...jsonSchema };
  return {
    jsonSchema: schema,
    "~standard": {
      version: 1,
      vendor: JSON_SCHEMA_VENDOR,
      validate(value: unknown): StandardResult<Record<string, unknown>> {
        const input = value === undefined || value === null ? {} : value;
        if (!isPlainObject(input)) return { issues: [{ message: `Expected object, received ${typeOfJson(input)}`, path: [] }] };
        const validator = new Validator(schema, resolved);
        const cleaned = validator.validate(schema, input, [], 0);
        if (validator.issues.length > 0) return { issues: validator.issues };
        return { value: cleaned as Record<string, unknown> };
      },
    },
  };
}
