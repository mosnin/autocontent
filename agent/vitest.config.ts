import { markdownImportPlugin } from "@flue/vite/internal";
import { defineConfig, type Plugin } from "vitest/config";

// Node tests: harness acceptance (real Flue runtime + scripted model), edge security contract,
// end-to-end ingestion with in-memory bindings, and your own tool/policy unit tests. Live agent
// behaviour is covered by the eval suite (pnpm evals).
// `pnpm test:coverage` writes text + HTML + lcov reports to coverage/ (uploaded by CI).
// One copy of the agent runtime: Flue hooks keep per-render state in module scope, so a second
// copy (workspaces, vendored packages, mismatched peer variants) would split the hook context.

/**
 * `cloudflare:workers` / `cloudflare:email` exist only inside workerd. Node tests that import Worker
 * modules (routes, queue handlers) get inert stand-ins: `env` is empty (pass bindings explicitly or
 * `vi.mock("cloudflare:workers", …)`), the base classes only keep `ctx`/`env`. Packages that import these
 * modules are inlined so the stand-ins apply to them too.
 */
const WORKERD_STUBS: Record<string, string> = {
  "cloudflare:workers": `export const env = {};
export const exports = {};
export function waitUntil() {}
class Base { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }
export class DurableObject extends Base {}
export class WorkerEntrypoint extends Base {}
export class WorkflowEntrypoint extends Base {}
export class RpcTarget {}
export class WorkflowEvent {}
export default { env, exports, waitUntil, DurableObject, WorkerEntrypoint, WorkflowEntrypoint, RpcTarget, WorkflowEvent };`,
  "cloudflare:email": `export class EmailMessage { constructor(from, to, raw) { this.from = from; this.to = to; this.raw = raw; } }`,
};

const workerdStubs = (): Plugin => ({
  name: "agent-starter:workerd-stubs",
  enforce: "pre",
  resolveId: (id) => (id in WORKERD_STUBS ? `\0${id}` : null),
  load: (id) => (id.startsWith("\0cloudflare:") ? WORKERD_STUBS[id.slice(1)] : null),
});

export default defineConfig({
  // Agent modules import runtime skills (`../skills/<name>/SKILL.md`): load them exactly as `pnpm build` does.
  plugins: [workerdStubs(), markdownImportPlugin()],
  resolve: { dedupe: ["@flue/runtime", "@earendil-works/pi-ai", "@earendil-works/pi-agent-core"] },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    // Dependencies that import `cloudflare:*` modules (resolved by the stubs above instead of Node's loader).
    server: { deps: { inline: ["agents", "@cloudflare/codemode", "@cloudflare/workers-oauth-provider"] } },
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.generated.ts", "src/skills/**"],
    },
  },
});
