import { z } from "zod";

/**
 * Standard Schema v1 (https://standardschema.dev) — implemented by zod 4,
 * valibot 1, arktype, effect schema. The engine validates tool input through
 * this interface so tools can be authored with zod or valibot (Flue requires
 * valibot), without the core depending on either.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}

export type StandardResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<{ readonly message: string; readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined }> };

export type InferOutput<S> = S extends StandardSchemaV1<unknown, infer O> ? O : never;

export async function validateStandard<S extends StandardSchemaV1>(schema: S, value: unknown): Promise<{ ok: true; value: InferOutput<S> } | { ok: false; issues: string[] }> {
  const result = await schema["~standard"].validate(value);
  if (result.issues) {
    return {
      ok: false,
      issues: result.issues.map((issue) => {
        const path = (issue.path ?? []).map((p) => (typeof p === "object" && p !== null && "key" in p ? String(p.key) : String(p))).join(".");
        return `${path || "$"}: ${issue.message}`;
      }),
    };
  }
  return { ok: true, value: result.value as InferOutput<S> };
}

export type JsonSchemaConverter = (schema: StandardSchemaV1) => Record<string, unknown> | undefined;

const converters: JsonSchemaConverter[] = [
  (schema) => {
    if (schema["~standard"].vendor !== "zod") return undefined;
    return z.toJSONSchema(schema as unknown as z.ZodType, { target: "draft-7", unrepresentable: "any", io: "input" }) as Record<string, unknown>;
  },
];

/** Register a JSON Schema converter for another schema vendor (e.g. valibot via @valibot/to-json-schema). */
export function registerJsonSchemaConverter(converter: JsonSchemaConverter): void {
  converters.unshift(converter);
}

export function toJsonSchema(schema: StandardSchemaV1): Record<string, unknown> {
  for (const convert of converters) {
    const result = convert(schema);
    if (result) {
      const { $schema: _ignored, ...rest } = result;
      return rest;
    }
  }
  throw new Error(`No JSON Schema converter registered for schema vendor "${schema["~standard"].vendor}"`);
}
