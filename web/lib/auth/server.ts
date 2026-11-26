import "server-only";

// The Better Auth instance for the web app. Created on first use, so building
// the app (which imports route modules) needs no database or secret.

import { createAuth, type AuthInstance } from "./config";

let instance: ReturnType<typeof createAuth> | null = null;

function get(): ReturnType<typeof createAuth> {
  instance ??= createAuth();
  return instance;
}

/** The Better Auth server instance. Use `auth().api.*` on the server; the browser talks to /api/auth. */
export function auth(): AuthInstance {
  return get().auth;
}

/** The pool behind it, for the few raw reads (membership lists, the audit log). */
export function authPool() {
  return get().pool;
}

export type Session = AuthInstance["$Infer"]["Session"];
