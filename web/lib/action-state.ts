// Shared action-state types and the empty default.
//
// Lives outside of `web/lib/actions.ts` on purpose: Next.js 15 enforces
// that everything exported from a `"use server"` module must be an async
// function. Exporting a const or a non-function type from `actions.ts`
// breaks the RSC bundler during static prerender (`/connect`, `/_not-found`).

export interface ActionState {
  ok: boolean;
  error?: string;
}

export const EMPTY_STATE: ActionState = { ok: false };
