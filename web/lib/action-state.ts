// Plain-object companion to `web/lib/actions.ts`. The actions file is
// marked `"use server"`, which restricts its exports to async
// functions only (Next 15.5+ enforces this). Anything that isn't a
// server action — type aliases, the empty-state sentinel —
// lives here.

export interface ActionState {
  ok: boolean;
  error?: string;
}

export const EMPTY_STATE: ActionState = { ok: false };
