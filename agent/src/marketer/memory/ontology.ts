/**
 * The marketing ontology (plan section 3.2, item 1): the only entity types, attributes and relations memory may hold.
 *
 * Extraction output, tool input and the backend all validate against this table in code; a fact that does not fit is
 * rejected, never coerced. The same table is pinned in `docs/memory/ontology.json` (tests on both sides compare
 * against that file), so the agent and the backend cannot drift apart silently.
 *
 *  - `one`:  the slot (subject + predicate) holds a single current value; a new value supersedes the old one.
 *  - `many`: the slot holds a set; a new value is added, an equal value is a duplicate.
 *  - `ruleBearing`: the fact acts as a brand rule (what Marketer must or must not say). It only becomes current once
 *    a person has confirmed it (docs/memory/trust.md).
 */

export const ENTITY_TYPES = ["brand", "audience", "offer", "product", "competitor", "channel", "campaign", "creative", "claim", "rule", "preference"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export type Cardinality = "one" | "many";

export interface AttributeSpec {
  cardinality: Cardinality;
  /** Closed vocabulary; when set, any other value is invalid. */
  values?: readonly string[];
  ruleBearing?: boolean;
}

export interface RelationSpec {
  from: readonly EntityType[];
  to: readonly EntityType[];
  cardinality: Cardinality;
  ruleBearing?: boolean;
}

export const ATTRIBUTES: Record<EntityType, Record<string, AttributeSpec>> = {
  brand: { name: { cardinality: "one" }, voice: { cardinality: "one" }, positioning: { cardinality: "one" }, tagline: { cardinality: "one" }, mission: { cardinality: "one" }, website: { cardinality: "one" } },
  audience: { description: { cardinality: "one" }, pain_point: { cardinality: "many" }, goal: { cardinality: "many" }, language: { cardinality: "one" }, location: { cardinality: "one" } },
  offer: { description: { cardinality: "one" }, price: { cardinality: "one" }, guarantee: { cardinality: "one" }, deadline: { cardinality: "one" } },
  product: { description: { cardinality: "one" }, price: { cardinality: "one" }, feature: { cardinality: "many" }, category: { cardinality: "one" } },
  competitor: { positioning: { cardinality: "one" }, price: { cardinality: "one" }, strength: { cardinality: "many" }, weakness: { cardinality: "many" }, website: { cardinality: "one" } },
  channel: { handle: { cardinality: "one" }, cadence: { cardinality: "one" }, best_time: { cardinality: "one" }, format: { cardinality: "many" } },
  campaign: { goal: { cardinality: "one" }, status: { cardinality: "one" }, window: { cardinality: "one" }, budget_note: { cardinality: "one" } },
  creative: { hook: { cardinality: "one" }, format: { cardinality: "one" }, angle: { cardinality: "one" } },
  claim: { text: { cardinality: "one" }, status: { cardinality: "one", values: ["approved", "forbidden"], ruleBearing: true }, proof: { cardinality: "many" } },
  rule: { text: { cardinality: "one", ruleBearing: true }, scope: { cardinality: "one", ruleBearing: true } },
  preference: { text: { cardinality: "one" } },
};

export const RELATIONS: Record<string, RelationSpec> = {
  targets: { from: ["brand", "offer", "product", "campaign", "creative"], to: ["audience"], cardinality: "many" },
  competes_with: { from: ["brand", "offer", "product"], to: ["competitor"], cardinality: "many" },
  runs_on: { from: ["campaign", "creative"], to: ["channel"], cardinality: "many" },
  offers: { from: ["brand"], to: ["offer", "product"], cardinality: "many" },
  promotes: { from: ["campaign", "creative"], to: ["offer", "product"], cardinality: "many" },
  makes: { from: ["brand", "creative", "competitor"], to: ["claim"], cardinality: "many" },
  forbids: { from: ["brand", "rule"], to: ["claim", "channel", "creative"], cardinality: "many", ruleBearing: true },
  prefers: { from: ["brand", "audience"], to: ["channel", "creative", "preference"], cardinality: "many" },
};
export type RelationName = keyof typeof RELATIONS;

export const ONTOLOGY_VERSION = "marketing.v1";

/** Plain-data form of the ontology (what `docs/memory/ontology.json` pins). */
export function ontologySnapshot(): { version: string; entityTypes: string[]; attributes: Record<string, Record<string, AttributeSpec>>; relations: Record<string, RelationSpec> } {
  return JSON.parse(JSON.stringify({ version: ONTOLOGY_VERSION, entityTypes: ENTITY_TYPES, attributes: ATTRIBUTES, relations: RELATIONS }));
}

export function isEntityType(value: unknown): value is EntityType {
  return typeof value === "string" && (ENTITY_TYPES as readonly string[]).includes(value);
}

export type PredicateSpec = ({ kind: "attribute" } & AttributeSpec) | ({ kind: "relation" } & RelationSpec);

/** The spec of `predicate` on a subject of `type`, or undefined when the ontology has no such predicate. */
export function predicateSpec(type: EntityType, predicate: string): PredicateSpec | undefined {
  const attribute = Object.hasOwn(ATTRIBUTES[type], predicate) ? ATTRIBUTES[type][predicate] : undefined;
  if (attribute) return { kind: "attribute", ...attribute };
  const relation = Object.hasOwn(RELATIONS, predicate) ? RELATIONS[predicate] : undefined;
  if (relation && relation.from.includes(type)) return { kind: "relation", ...relation };
  return undefined;
}

/** Stable key of an entity name inside a tenant: lower-case, alphanumerics joined by "-"; names without any get a hash. */
export function entityKey(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (slug) return slug;
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
  return `x${(h >>> 0).toString(36)}`;
}
