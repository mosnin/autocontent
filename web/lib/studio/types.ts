/**
 * marketer.sh Studio — model catalog types.
 *
 * Every studio control is schema-driven: a model entry carries an `inputs`
 * object describing each parameter the generation endpoint accepts, and the
 * selectors in `model-selectors.ts` read that schema to decide which controls
 * to render, which options to offer, and what to default to.
 *
 * These types are deliberately permissive. The catalog data is vendor-supplied
 * and heterogeneous; no model entry should ever need editing to typecheck.
 */

/** Any value expressible in the catalog's JSON data. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** A value that can appear in an `enum` option list. */
export type EnumValue = string | number;

/**
 * One parameter in a model's `inputs` schema.
 *
 * `type` is the vendor's own type tag (`string`, `int`, `float`, `boolean`,
 * `array`, `file`, …) rather than a TypeScript type.
 */
export interface ModelInputField {
  /** Vendor type tag: "string" | "int" | "float" | "boolean" | "array" | "file" | … */
  type?: string;
  /** Human-readable label for the control. */
  title?: string;
  /** Payload key this field is sent as. */
  name?: string;
  /** Help text shown alongside the control. */
  description?: string;
  /** Default value; may be null. */
  default?: JsonValue;
  /** Allowed values — drives select/segmented controls. */
  enum?: EnumValue[];
  /** Example values — drives prompt placeholders and suggestions. */
  examples?: JsonValue[];
  /** Numeric bounds (vendor spelling varies between minValue/minimum). */
  minValue?: number;
  maxValue?: number;
  minimum?: number;
  maximum?: number;
  /** Slider increment, also used to expand a numeric range into discrete options. */
  step?: number;
  /** Item schema for array-typed fields. */
  items?: JsonValue;
  minItems?: number;
  maxItems?: number;
  /** Option lists that depend on the value of another field. */
  enum_dependencies?: JsonValue;
  /** Presentation hints. */
  placeholder?: string;
  format?: string;
  field?: string;
  isEdit?: boolean;
  typing?: boolean;
  /** Vendor schemas occasionally carry extra keys; keep them addressable. */
  [key: string]: unknown;
}

/** A model's full input schema, keyed by payload field name. */
export type ModelInputs = Record<string, ModelInputField>;

/** One entry in the model catalog. */
export interface ModelDefinition {
  /** Stable catalog id used by the selectors and persisted in UI preferences. */
  id: string;
  /** Vendor's model name, shown verbatim in the picker. */
  name: string;
  /** Generation endpoint slug. */
  endpoint?: string;
  /** Parameter schema driving the dynamic controls. */
  inputs?: ModelInputs;
  /** Provider attribution. */
  provider?: string;
  provider_name?: string;
  /** Grouping hints. */
  family?: string;
  category?: string;
  description?: string;
  /** Payload field names for attached media. */
  imageField?: string;
  lastImageField?: string;
  videoField?: string;
  swapField?: string;
  /** Maximum reference images this model accepts. */
  maxImages?: number;
  /** Capability flags. */
  hasPrompt?: boolean;
  hasSeed?: boolean;
  promptRequired?: boolean;
  requiresRequestId?: boolean;
  /** Required payload field names. */
  required?: string[];
  /** Vendor entries occasionally carry extra keys; keep them addressable. */
  [key: string]: unknown;
}
