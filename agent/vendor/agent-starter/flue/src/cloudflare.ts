/**
 * Cloudflare entry for @agent-starter/flue. Import once from `src/app.ts`:
 *
 *   import "@agent-starter/flue/cloudflare";
 *
 * It connects Agent Starter's state (budgets, approvals, goal tree, memory,
 * audit log) to each Flue agent's own Durable Object SQLite and exposes Worker
 * env bindings to guarded tools.
 */
import { getCloudflareContext } from "@flue/runtime/cloudflare";
import { registerCloudflareContext } from "./runtime.ts";

registerCloudflareContext(() => getCloudflareContext() as never);

export { registerCloudflareContext };
