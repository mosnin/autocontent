import { AgentError, type AnyAgentTool, defineAgentTool, type SideEffect, type ToolExecutionContext, ToolExecutor, type ToolExecutorOptions } from "@agent-starter/core";
import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { z } from "zod";

/** Minimal executor surface (lets tests inject a fake sandbox). */
export interface CodeSandbox {
  execute(code: string, fns: Record<string, (...args: unknown[]) => Promise<unknown>>): Promise<{ result?: unknown; error?: string; logs?: string[] }>;
}

export interface CodeExecutionToolOptions {
  /** `worker_loaders` binding (wrangler: "worker_loaders": [{ "binding": "LOADER" }]). */
  loader: unknown;
  /** Tools the generated code may call as `codemode.<name>(args)` — each call still goes through the ToolExecutor pipeline. */
  tools: AnyAgentTool[];
  /**
   * Executor wiring for the inner calls. Pass a factory to get fresh per-run
   * state (firewall quotas, budget) for every `run_code` call instead of one
   * instance shared across tenants and runs.
   */
  executor?: Omit<ToolExecutorOptions, "tools"> | ((ctx: ToolExecutionContext) => Omit<ToolExecutorOptions, "tools">);
  timeoutMs?: number;
  /** Override the sandbox (tests). Defaults to a no-network Dynamic Worker. */
  sandbox?: CodeSandbox;
}

const SIDE_EFFECT_ORDER: SideEffect[] = ["none", "read", "write", "external", "destructive"];

/** The strongest side effect any inner tool can cause (run_code is only as harmless as its tool surface). */
export function codeExecutionSideEffect(tools: AnyAgentTool[]): SideEffect {
  let max = 0;
  for (const tool of tools) max = Math.max(max, SIDE_EFFECT_ORDER.indexOf(tool.sideEffect));
  // The sandbox itself never touches the outside world; with no tools it is a pure computation ("none").
  return SIDE_EFFECT_ORDER[max] ?? "none";
}

/**
 * Secure code sandbox: model-written JavaScript runs in a throwaway Dynamic
 * Worker isolate with NO network (`globalOutbound: null`), NO bindings/env and
 * a hard timeout. The only way out is the explicit tool surface, and every tool
 * call made from inside the sandbox is re-validated, tenant-checked and
 * risk-gated exactly as if the model had called it directly.
 *
 * - Gated by the tenant feature flag `features.codeExecution` (off in the
 *   secure default config).
 * - `sideEffect` is the strongest side effect of the inner tools and
 *   `idempotent` is false, so a `run_code` that can write is never retried
 *   automatically.
 * - Inner calls get deterministic ids (`<toolCallId>:<tool>:<n>`), so the
 *   idempotency store dedupes them when the same run_code call is replayed.
 */
export function createCodeExecutionTool(options: CodeExecutionToolOptions): AnyAgentTool {
  const sandbox: CodeSandbox = options.sandbox ?? (new DynamicWorkerExecutor({ loader: options.loader, timeout: options.timeoutMs ?? 30_000, globalOutbound: null } as never) as unknown as CodeSandbox);
  const names = options.tools.map((t) => `codemode.${t.name}(args)`).join(", ");
  const sideEffect = codeExecutionSideEffect(options.tools);
  return defineAgentTool({
    name: "run_code",
    description: `Run a short async JavaScript function in an isolated sandbox (no network, no secrets). Available calls: ${names || "none"}. Return a JSON-serializable value; console.log output is captured.`,
    input: z.object({ code: z.string().min(1).max(20_000).describe("An async arrow function body, e.g. async () => { const x = await codemode.lookup({ id: '1' }); return x; }") }),
    risk: sideEffect === "destructive" ? "HIGH" : "MEDIUM",
    sideEffect,
    idempotent: false,
    timeoutMs: (options.timeoutMs ?? 30_000) + 5000,
    outputTrust: "untrusted",
    execute: async ({ code }, ctx) => {
      if (ctx.tenantConfig.features?.codeExecution !== true) {
        throw new AgentError("TOOL_NOT_ALLOWED", "Code execution is not enabled for this tenant (features.codeExecution).");
      }
      const executorOptions = typeof options.executor === "function" ? options.executor(ctx) : options.executor;
      const toolExecutor = new ToolExecutor({ ...executorOptions, tools: options.tools });
      const sequence = new Map<string, number>();
      const fns: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
      for (const tool of options.tools) {
        fns[tool.name] = async (args: unknown) => {
          const n = (sequence.get(tool.name) ?? 0) + 1;
          sequence.set(tool.name, n);
          const { toolCallId: _id, idempotencyKey: _key, ...callContext } = ctx;
          const outcome = await toolExecutor.execute({ id: `${ctx.toolCallId}:${tool.name}:${n}`, name: tool.name, arguments: args ?? {} }, callContext);
          if (outcome.status === "ok" || outcome.status === "simulated") return outcome.output;
          throw new Error(outcome.text);
        };
      }
      const result = await sandbox.execute(code, fns);
      if (result.error) return { ok: false, error: result.error, logs: result.logs ?? [] };
      return { ok: true, result: result.result, logs: result.logs ?? [] };
    },
  });
}
