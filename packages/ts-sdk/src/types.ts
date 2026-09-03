/**
 * Minimal stand-in until `npm run generate` is pointed at docs/api/openapi.json.
 * Named wrappers in index.ts do not depend on generated operation types.
 */
export interface paths {
  [path: string]: unknown;
}

export interface components {
  schemas: Record<string, unknown>;
}

export interface operations {
  [name: string]: unknown;
}
