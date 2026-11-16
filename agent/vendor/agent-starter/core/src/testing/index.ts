import { DatabaseSync } from "node:sqlite";
import type { ModelProvider, ModelRequest, ModelResponse, ToolCall } from "../models/types.ts";
import type { SqlStore, SqlValue } from "../storage/ports.ts";

/**
 * Real SQLite (node:sqlite) implementing the Durable Object SQL surface, for
 * tests, evals and local scripts. Node-only: import from
 * "@agent-starter/core/testing", never from Worker code.
 */
export class NodeSqlStore implements SqlStore {
  readonly db: DatabaseSync;
  private depth = 0;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  exec<T = Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]): T[] {
    const statement = this.db.prepare(query);
    const params = bindings.map((b) => (b instanceof ArrayBuffer ? new Uint8Array(b) : b)) as Array<string | number | bigint | null | Uint8Array>;
    if (/^\s*(select|with|pragma)/i.test(query) || /\breturning\b/i.test(query)) return statement.all(...params) as T[];
    statement.run(...params);
    return [];
  }

  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.depth++;
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.depth--;
    }
  }
}

export type ScriptStep = Omit<Partial<ModelResponse>, "toolCalls"> & { toolCalls?: Array<Omit<ToolCall, "id"> & { id?: string }> };

/**
 * Deterministic model for tests and evals: returns scripted responses in order,
 * or computes them from the request. Records every request it received.
 */
export class ScriptedModelProvider implements ModelProvider {
  readonly id: string;
  readonly defaultModel: string;
  readonly requests: ModelRequest[] = [];
  private index = 0;

  constructor(
    private readonly script: ScriptStep[] | ((request: ModelRequest, index: number) => ScriptStep | Promise<ScriptStep>),
    options: { id?: string; model?: string } = {},
  ) {
    this.id = options.id ?? "scripted";
    this.defaultModel = options.model ?? "scripted-model";
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const i = this.index++;
    const step = typeof this.script === "function" ? await this.script(request, i) : (this.script[Math.min(i, this.script.length - 1)] ?? { text: "" });
    const toolCalls = (step.toolCalls ?? []).map((c, n) => ({ id: c.id ?? `call_${i}_${n}`, name: c.name, arguments: c.arguments }));
    return {
      text: step.text ?? "",
      toolCalls,
      usage: step.usage ?? { inputTokens: 100, outputTokens: 50, reasoningTokens: 0, cachedInputTokens: 0 },
      model: step.model ?? request.model ?? this.defaultModel,
      provider: this.id,
      finishReason: step.finishReason ?? (toolCalls.length ? "tool_calls" : "stop"),
      ...(step.reasoning ? { reasoning: step.reasoning } : {}),
    };
  }
}

/** Provider that always fails with the given error (circuit breaker / fallback tests). */
export class FailingModelProvider implements ModelProvider {
  calls = 0;
  constructor(
    readonly id: string,
    private readonly error: () => Error,
    readonly defaultModel = "failing-model",
  ) {}
  async generate(): Promise<ModelResponse> {
    this.calls++;
    throw this.error();
  }
}
