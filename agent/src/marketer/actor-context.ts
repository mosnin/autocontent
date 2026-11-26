/**
 * The person a Marketer run acts for (the "actor"), as the API client reads it.
 *
 * The actor rides on the tool execution context under a module-private symbol, set only by `withActor`
 * (src/marketer/actor.ts) from a verified session. Nothing the model writes can reach it: tool arguments are JSON
 * (no symbols), bus messages and room turns carry text, and a string key such as `services.marketerActor` is ignored.
 * No imports, so the API client and every tools module load it without a cycle.
 */

export interface Actor {
  /** The person's id (the session token's `sub`). Sent to the backend as `x-actor-id`. */
  readonly id: string;
  /** Their workspace role(s) from the session token (one catalog role in practice). */
  readonly roles: readonly string[];
  /** Their permissions from the session token, as `resource:action` strings. */
  readonly scopes: readonly string[];
}

/**
 * Ids we put in a header: what Better Auth (and the old Clerk ids carried over as person ids) produce, plus the email
 * shape the dev tooling uses, up to the 256 characters the web app mints. Anything else (control characters, spaces,
 * commas, overlong) is not sent.
 */
export const ACTOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:@+|=~-]{0,255}$/;

/**
 * A person whose identity cannot be carried (an id we would not put in a header): every Marketer tool is refused and
 * nothing is sent. Never "no actor", which would mean the broader unattended permissions.
 */
export const BLOCKED_ACTOR: Actor = Object.freeze({ id: "", roles: Object.freeze([]), scopes: Object.freeze([]) });

const ACTOR = Symbol("marketer.actor");

const strings = (value: unknown, max: number): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length <= 64).slice(0, max) : []);

/** A frozen, validated actor, or null when the input is not one. */
export function makeActor(input: { id?: unknown; roles?: unknown; scopes?: unknown } | null | undefined): Actor | null {
  if (!input || typeof input !== "object") return null;
  if (typeof input.id !== "string" || !ACTOR_ID_PATTERN.test(input.id)) return null;
  return Object.freeze({ id: input.id, roles: Object.freeze(strings(input.roles, 8)), scopes: Object.freeze(strings(input.scopes, 128)) });
}

/** `services` with the actor set (null = explicitly none: a run with no person sends no actor header). */
export function servicesWithActor(services: Record<string, unknown> | undefined, actor: Actor | null): Record<string, unknown> {
  return { ...(services ?? {}), [ACTOR]: actor };
}

/** The actor `withActor` put on this call, or null. */
export function actorFromServices(services: Record<string, unknown> | undefined): Actor | null {
  const value = services ? (services as Record<symbol, unknown>)[ACTOR] : undefined;
  return value ? makeActor(value as Actor) : null;
}
