/**
 * Supermemory namespace derivation: the ONLY place in the agent a namespace is made (docs/memory/supermemory.md).
 *
 *   team:     "mkt-t-" + hex(HMAC-SHA256(MEMORY_NAMESPACE_SECRET, "v1|team|"   + tenantId))[0:40]
 *   personal: "mkt-p-" + hex(HMAC-SHA256(MEMORY_NAMESPACE_SECRET, "v1|person|" + tenantId + "|" + personId))[0:40]
 *
 * Inputs come from verified identity only: the session's tenant (`ctx.tenant.tenantId`, from agentAuth) and the actor
 * (`sub`, src/marketer/actor.ts). Never a tool argument, model output, bus message or URL. Ids containing `|` are
 * refused, not derived. The backend derives the same values (src/marketer/recall/namespace.py); both test against
 * docs/memory/supermemory-namespaces.json. `test/recall.test.ts` fails if any other module spells a namespace prefix
 * or builds a namespace URL path.
 */

export type ScopeKind = "team" | "personal";

const PREFIX: Record<ScopeKind, string> = { team: "mkt-t-", personal: "mkt-p-" };
const VERSION = "v1";
const HEX_CHARS = 40;
const MAX_ID = 256;

const SCOPE = Symbol("marketer.recall.scope");

/**
 * One namespace and what it is. The Supermemory client accepts only this (it checks the private brand), so a string
 * from anywhere else can never reach it. Build one with `deriveScope`.
 */
export interface Scope {
  readonly kind: ScopeKind;
  readonly [SCOPE]: string;
}

export class NamespaceRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NamespaceRefused";
  }
}

function checkId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID) throw new NamespaceRefused(`${label} is missing or too long`);
  if (value.includes("|") || /[\u0000-\u001f]/.test(value)) throw new NamespaceRefused(`${label} contains a reserved character`);
  return value;
}

export function namespaceMessage(kind: ScopeKind, tenantId: string, personId?: string | null): string {
  const tenant = checkId(tenantId, "tenant id");
  if (kind === "team") {
    if (personId !== undefined && personId !== null) throw new NamespaceRefused("a team namespace has no person");
    return `${VERSION}|team|${tenant}`;
  }
  return `${VERSION}|person|${tenant}|${checkId(personId, "person id")}`;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The namespace string (tests and the client only). Throws `NamespaceRefused` on bad input. */
export async function deriveNamespace(kind: ScopeKind, tenantId: string, personId: string | null | undefined, secret: string): Promise<string> {
  if (typeof secret !== "string" || secret.length === 0) throw new NamespaceRefused("MEMORY_NAMESPACE_SECRET is not set");
  const message = namespaceMessage(kind, tenantId, personId);
  return PREFIX[kind] + (await hmacHex(secret, message)).slice(0, HEX_CHARS);
}

export async function deriveScope(kind: ScopeKind, tenantId: string, personId: string | null | undefined, secret: string): Promise<Scope> {
  const namespace = await deriveNamespace(kind, tenantId, personId, secret);
  const scope = { kind } as Scope;
  Object.defineProperty(scope, SCOPE, { value: namespace, enumerable: false });
  return Object.freeze(scope);
}

/** The namespace inside a scope, or null when `value` is not a scope built here. Only the client calls this. */
export function namespaceOf(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const ns = (value as Record<symbol, unknown>)[SCOPE];
  return typeof ns === "string" && /^mkt-[tp]-[0-9a-f]{40}$/.test(ns) ? ns : null;
}
