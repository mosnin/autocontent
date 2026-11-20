import { z } from "zod";
import { completeJson } from "../models/structured.ts";
import type { ModelProvider } from "../models/types.ts";
import type { SqlStore } from "../storage/ports.ts";
import { truncateMiddle } from "../util/text.ts";

export const ScratchpadFrameSchema = z.object({
  currentFocus: z.string().max(500),
  factsEstablished: z.array(z.string().max(400)).max(40),
  failedAttempts: z.array(z.string().max(400)).max(20),
  nextPlannedAction: z.string().max(500),
});
export type ScratchpadFrame = z.infer<typeof ScratchpadFrameSchema>;

export const INITIAL_FRAME: ScratchpadFrame = {
  currentFocus: "Initializing root task objective.",
  factsEstablished: [],
  failedAttempts: [],
  nextPlannedAction: "Evaluate the incoming event payload.",
};

/**
 * Working-memory compactor. Raw terminal output and tool dumps never accumulate
 * in the prompt; a cheap first-line model folds them into a compact frame of
 * established facts, failed strategies and the next micro-step, persisted in
 * SQLite and cached in memory between turns.
 */
export class ScratchpadCompactor {
  private cache: ScratchpadFrame | null = null;

  constructor(
    /** `keepHistory`: frames kept per run in `as_scratchpad` (older ones are pruned on save). Default 20. */
    private readonly options: { runId: string; sql?: SqlStore; model?: ModelProvider; maxRawChars?: number; clock?: () => number; keepHistory?: number },
  ) {}

  current(): ScratchpadFrame {
    if (this.cache) return this.cache;
    const row = this.options.sql?.exec<{ current_focus: string; facts_established: string; failed_attempts: string; next_planned_action: string }>(
      `SELECT current_focus, facts_established, failed_attempts, next_planned_action FROM as_scratchpad WHERE run_id = ? ORDER BY id DESC LIMIT 1`,
      this.options.runId,
    )[0];
    this.cache = row
      ? {
          currentFocus: row.current_focus,
          factsEstablished: JSON.parse(row.facts_established) as string[],
          failedAttempts: JSON.parse(row.failed_attempts) as string[],
          nextPlannedAction: row.next_planned_action,
        }
      : { ...INITIAL_FRAME };
    return this.cache;
  }

  /** Fold new raw logs into the frame. Falls back to a deterministic merge when no model is available or it fails. */
  async compact(rawLogs: string, objective?: string): Promise<ScratchpadFrame> {
    const previous = this.current();
    const raw = truncateMiddle(rawLogs, this.options.maxRawChars ?? 12_000);
    let next: ScratchpadFrame;
    if (this.options.model) {
      try {
        const { value } = await completeJson(this.options.model, ScratchpadFrameSchema, {
          system: "You are a Working Memory Compactor for an autonomous agent. Compress raw execution logs into a clean cognitive frame. Keep facts verifiable and short; record failed strategies so they are not repeated.",
          prompt: `${objective ? `ROOT OBJECTIVE: ${objective}\n\n` : ""}PREVIOUS FRAME:\n${JSON.stringify(previous)}\n\nNEW RAW EXECUTION LOGS OR ERRORS:\n${raw}`,
          schemaName: "scratchpad_frame",
          maxOutputTokens: 800,
        });
        next = value;
      } catch {
        next = this.deterministicMerge(previous, raw);
      }
    } else {
      next = this.deterministicMerge(previous, raw);
    }
    this.save(next);
    return next;
  }

  save(frame: ScratchpadFrame): void {
    this.cache = frame;
    this.options.sql?.exec(
      `INSERT INTO as_scratchpad (run_id, current_focus, facts_established, failed_attempts, next_planned_action, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      this.options.runId,
      frame.currentFocus,
      JSON.stringify(frame.factsEstablished),
      JSON.stringify(frame.failedAttempts),
      frame.nextPlannedAction,
      (this.options.clock ?? Date.now)(),
    );
    // Every tool batch saves a frame: keep only the recent history per run.
    this.options.sql?.exec(
      `DELETE FROM as_scratchpad WHERE run_id = ? AND id NOT IN (SELECT id FROM as_scratchpad WHERE run_id = ? ORDER BY id DESC LIMIT ?)`,
      this.options.runId,
      this.options.runId,
      Math.max(1, this.options.keepHistory ?? 20),
    );
  }

  render(frame: ScratchpadFrame = this.current()): string {
    return [
      "[WORKING MEMORY SCRATCHPAD]",
      `- Active focus: ${frame.currentFocus}`,
      `- Established facts: ${frame.factsEstablished.length ? frame.factsEstablished.join(" | ") : "none yet"}`,
      `- Known blocked paths (do not repeat): ${frame.failedAttempts.length ? frame.failedAttempts.join(" | ") : "none"}`,
      `- Intended next step: ${frame.nextPlannedAction}`,
    ].join("\n");
  }

  /**
   * No model (or it failed): successful tool results (`tool → ok: …` lines, as the Flue hook folds
   * every batch) become short facts, failures become failed attempts, so the frame still tracks
   * progress without a utility model.
   */
  private deterministicMerge(previous: ScratchpadFrame, raw: string): ScratchpadFrame {
    // Split into entries: a `tool → status:` (or `tool(args) → status:`) header plus its continuation
    // lines; free-form log lines stay one entry each.
    const header = /^([\w.:-]{1,64})(?:\([^\n]*?\))? → ([a-z_]+):/;
    const entries: Array<{ status: string | null; text: string }> = [];
    for (const rawLine of raw.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const match = header.exec(line);
      const last = entries.at(-1);
      if (match) entries.push({ status: match[2] as string, text: line });
      else if (last && last.status !== null) last.text += ` ${line}`;
      else entries.push({ status: null, text: line });
    }
    const flatten = (text: string) => text.replace(/<\/?untrusted_content[^>]*>/gi, " ").replace(/\s+/g, " ").trim();
    const facts = entries.filter((e) => e.status === "ok" || e.status === "simulated").slice(-5).map((e) => flatten(e.text).slice(0, 240));
    const failures = entries
      .filter((e) => (e.status ? e.status !== "ok" && e.status !== "simulated" : /error|failed|exception|denied|timed out/i.test(e.text)))
      .slice(-3)
      .map((e) => flatten(e.text).slice(0, 300));
    return {
      ...previous,
      factsEstablished: [...previous.factsEstablished, ...facts].filter((fact, index, all) => fact && all.indexOf(fact) === index).slice(-40),
      failedAttempts: [...previous.failedAttempts, ...failures].slice(-20),
    };
  }
}
