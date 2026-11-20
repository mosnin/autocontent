import { AgentError } from "../errors.ts";
import type { SqlStore } from "../storage/ports.ts";

export interface StateDefinition<C> {
  /** Instructions shown to the model while in this state. */
  instructions: string;
  /** The only tools the model may use in this state. */
  tools: string[];
  /** Allowed next states, optionally guarded by a predicate over the context. */
  transitions: Partial<Record<string, ((context: C) => boolean) | true>>;
  terminal?: boolean;
}

export interface MachineDefinition<S extends string, C> {
  id: string;
  initial: S;
  states: Record<S, StateDefinition<C>>;
}

export interface MachineSnapshot<S extends string, C> {
  state: S;
  context: C;
  history: Array<{ from: S; to: S; at: number; reason: string }>;
}

/**
 * Deterministic business-process state machine. The LLM reasons *within* the
 * active state (its instructions + tools) but cannot invent workflow paths:
 * transitions are explicit, guarded and persisted.
 *   e.g. INGEST → EVALUATE → EXECUTE → REPORT → DONE
 */
export class StateMachine<S extends string, C extends Record<string, unknown>> {
  private snapshot: MachineSnapshot<S, C>;

  constructor(
    readonly definition: MachineDefinition<S, C>,
    private readonly options: { instanceId: string; sql?: SqlStore; initialContext: C; clock?: () => number },
  ) {
    this.snapshot = this.load() ?? { state: definition.initial, context: options.initialContext, history: [] };
  }

  get state(): S {
    return this.snapshot.state;
  }

  get context(): C {
    return this.snapshot.context;
  }

  current(): StateDefinition<C> {
    return this.definition.states[this.snapshot.state];
  }

  allowedTools(): string[] {
    return this.current().tools;
  }

  isTerminal(): boolean {
    return this.current().terminal === true;
  }

  can(to: S): boolean {
    const guard = this.current().transitions[to];
    if (!guard) return false;
    return guard === true || guard(this.snapshot.context);
  }

  transition(to: S, reason: string, contextPatch: Partial<C> = {}): MachineSnapshot<S, C> {
    if (!(to in this.definition.states)) throw new AgentError("INVALID_STATE_TRANSITION", `Unknown state "${to}"`);
    const nextContext = { ...this.snapshot.context, ...contextPatch };
    const guard = this.current().transitions[to];
    if (!guard || (guard !== true && !guard(nextContext))) {
      throw new AgentError("INVALID_STATE_TRANSITION", `Transition ${this.snapshot.state} → ${to} is not allowed`, {
        details: { from: this.snapshot.state, to, allowed: Object.keys(this.current().transitions) },
      });
    }
    this.snapshot = {
      state: to,
      context: nextContext,
      history: [...this.snapshot.history, { from: this.snapshot.state, to, at: (this.options.clock ?? Date.now)(), reason }].slice(-100),
    };
    this.persist();
    return this.snapshot;
  }

  patchContext(patch: Partial<C>): void {
    this.snapshot = { ...this.snapshot, context: { ...this.snapshot.context, ...patch } };
    this.persist();
  }

  render(): string {
    const def = this.current();
    return [
      `[WORKFLOW STATE: ${this.snapshot.state}]`,
      def.instructions,
      `Tools available in this state: ${def.tools.join(", ") || "(none)"}`,
      `Allowed next states: ${Object.keys(def.transitions).join(", ") || "(terminal)"}`,
    ].join("\n");
  }

  private persist(): void {
    this.options.sql?.exec(
      `INSERT INTO as_fsm (machine_id, state, context_json, history_json, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(machine_id) DO UPDATE SET state = excluded.state, context_json = excluded.context_json, history_json = excluded.history_json, updated_at = excluded.updated_at`,
      `${this.definition.id}:${this.options.instanceId}`,
      this.snapshot.state,
      JSON.stringify(this.snapshot.context),
      JSON.stringify(this.snapshot.history),
      (this.options.clock ?? Date.now)(),
    );
  }

  private load(): MachineSnapshot<S, C> | null {
    const row = this.options.sql?.exec<{ state: string; context_json: string; history_json: string }>(
      `SELECT state, context_json, history_json FROM as_fsm WHERE machine_id = ?`,
      `${this.definition.id}:${this.options.instanceId}`,
    )[0];
    if (!row || !(row.state in this.definition.states)) return null;
    return { state: row.state as S, context: JSON.parse(row.context_json) as C, history: JSON.parse(row.history_json) as MachineSnapshot<S, C>["history"] };
  }
}

/** The canonical background-job workflow from the spec. */
export function createJobStateMachineDefinition(tools: { ingest: string[]; evaluate: string[]; execute: string[]; report: string[] }): MachineDefinition<"INGEST" | "EVALUATE" | "EXECUTE" | "REPORT" | "DONE" | "FAILED", Record<string, unknown>> {
  return {
    id: "job",
    initial: "INGEST",
    states: {
      INGEST: { instructions: "Validate and normalize the incoming event. Gather only the context needed to evaluate it.", tools: tools.ingest, transitions: { EVALUATE: true, FAILED: true } },
      EVALUATE: { instructions: "Decide what must be done. Produce or update the plan. Do not perform mutations in this state.", tools: tools.evaluate, transitions: { EXECUTE: true, REPORT: true, FAILED: true } },
      EXECUTE: { instructions: "Carry out the planned actions one goal at a time, verifying each result.", tools: tools.execute, transitions: { EVALUATE: true, REPORT: true, FAILED: true } },
      REPORT: { instructions: "Write the final report/artifacts and notify downstream systems.", tools: tools.report, transitions: { DONE: true, FAILED: true } },
      DONE: { instructions: "The job is complete. Do nothing further.", tools: [], transitions: {}, terminal: true },
      FAILED: { instructions: "The job failed. Summarize the failure for operators.", tools: tools.report, transitions: {}, terminal: true },
    },
  };
}
