import { completeText } from "../models/structured.ts";
import type { ModelProvider } from "../models/types.ts";
import type { SqlStore } from "../storage/ports.ts";
import { sha256Hex, stableStringify } from "../util/crypto.ts";

export interface Reflection {
  stepName: string;
  executedAction: string;
  observedError: string;
  critique: string;
  repeatCount: number;
  injection: string;
}

/**
 * Dual-loop critic. When a tool fails, the error is routed to a reviewer prompt
 * (cheap model) that names the blind spot and prescribes one pivot. Repeated
 * identical failures (same action fingerprint) escalate to a hard "stop doing
 * this" intervention so the agent never pays for the same bug five times.
 */
export class Critic {
  constructor(
    private readonly options: { runId: string; sql?: SqlStore; model?: ModelProvider; clock?: () => number },
  ) {}

  async reflect(input: { stepName: string; action: string; args?: unknown; error: string; objective?: string }): Promise<Reflection> {
    const fingerprint = (await sha256Hex(stableStringify({ a: input.action, g: input.args ?? null }))).slice(0, 24);
    const repeatCount =
      Number(
        this.options.sql?.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM as_reflections WHERE run_id = ? AND fingerprint = ?`, this.options.runId, fingerprint)[0]?.n ?? 0,
      ) + 1;

    let critique = defaultCritique(input.error, repeatCount);
    if (this.options.model) {
      try {
        const { text } = await completeText(this.options.model, {
          system: "You are a senior systems critic reviewing an autonomous agent's failed step. Be blunt and concise (max 4 sentences). Identify the logical blind spot and give exactly ONE concrete pivot strategy that does not repeat the failed approach.",
          prompt: `${input.objective ? `Objective: ${input.objective}\n` : ""}Failed step: ${input.stepName}\nAction: ${input.action}\nArguments: ${JSON.stringify(input.args ?? null).slice(0, 1500)}\nError: ${input.error.slice(0, 2000)}\nThis exact action has failed ${repeatCount} time(s).`,
          temperature: 0.3,
          maxOutputTokens: 300,
        });
        if (text) critique = text;
      } catch {
        // keep deterministic critique
      }
    }

    this.options.sql?.exec(
      `INSERT INTO as_reflections (run_id, step_name, executed_action, observed_error, critic_evaluation, pivoted_strategy, fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      this.options.runId,
      input.stepName,
      input.action,
      input.error.slice(0, 4000),
      critique,
      critique,
      fingerprint,
      (this.options.clock ?? Date.now)(),
    );

    const injection =
      repeatCount >= 3
        ? `[⛔ REPEATED FAILURE INTERCEPT] "${input.action}" has now failed ${repeatCount} times with the same arguments. You are FORBIDDEN from calling it this way again. ${critique} If no alternative exists, report the blocker and stop.`
        : `[⚠️ CRITICAL REFLECTION INTERCEPT] Your previous attempt at "${input.stepName}" failed: ${input.error.slice(0, 400)}\nCritique: ${critique}\nRequirement: abandon the previous approach, adapt your arguments, and apply this pivot.`;
    return { stepName: input.stepName, executedAction: input.action, observedError: input.error, critique, repeatCount, injection };
  }
}

function defaultCritique(error: string, repeat: number): string {
  if (/validation|schema|required|invalid/i.test(error)) return "The arguments did not match the tool contract; re-read the schema and supply every required field with the correct type.";
  if (/not found|404/i.test(error)) return "The referenced resource does not exist; look it up or list available resources before acting on it.";
  if (/permission|forbidden|unauthori[sz]ed|403|denied/i.test(error)) return "The action is not permitted in this context; choose a permitted alternative or escalate to a human.";
  if (/timeout|timed out/i.test(error)) return "The operation timed out; reduce the scope of work per call or try a cheaper approach.";
  return repeat > 1 ? "The same approach keeps failing; change strategy entirely." : "Analyze the error message and change at least one assumption before retrying.";
}
