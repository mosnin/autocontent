import type { ModelProvider } from "../models/types.ts";
import type { Embedder } from "../storage/ports.ts";
import { cosineSimilarity } from "../util/text.ts";

export interface DriftAssessment {
  aligned: boolean;
  similarity: number | null;
  method: "embedding" | "model" | "none";
  anchor?: string;
}

/**
 * Semantic drift sentinel (executive monitor). Compares the agent's current
 * focus with the root objective — by embedding cosine similarity when an
 * embedder is available, otherwise via a one-word classifier — and returns a
 * forceful context anchor when the agent wanders into irrelevant sub-tasks.
 */
export class DriftSentinel {
  private rootVector: { objective: string; vector: number[] } | null = null;

  constructor(
    private readonly options: { embedder?: Embedder; model?: ModelProvider; threshold?: number },
  ) {}

  async assess(rootObjective: string, currentFocus: string): Promise<DriftAssessment> {
    const threshold = this.options.threshold ?? 0.55;
    if (!rootObjective.trim() || !currentFocus.trim()) return { aligned: true, similarity: null, method: "none" };
    if (this.options.embedder) {
      try {
        if (!this.rootVector || this.rootVector.objective !== rootObjective) {
          const [vector] = await this.options.embedder.embed([rootObjective]);
          this.rootVector = { objective: rootObjective, vector: vector ?? [] };
        }
        const [focusVector] = await this.options.embedder.embed([currentFocus]);
        const similarity = cosineSimilarity(this.rootVector.vector, focusVector ?? []);
        const aligned = similarity >= threshold;
        return { aligned, similarity, method: "embedding", ...(aligned ? {} : { anchor: anchorText(rootObjective, currentFocus) }) };
      } catch {
        // fall back to the model check
      }
    }
    if (this.options.model) {
      try {
        const response = await this.options.model.generate({
          messages: [
            { role: "system", content: "Answer with exactly one word: ALIGNED or DRIFTED." },
            { role: "user", content: `Root objective: "${rootObjective}"\nCurrent focus: "${currentFocus}"\nIs the agent still driving toward the root objective, or has it drifted into an irrelevant, unproductive loop?` },
          ],
          temperature: 0,
          maxOutputTokens: 4,
        });
        const drifted = /DRIFTED/i.test(response.text);
        return { aligned: !drifted, similarity: null, method: "model", ...(drifted ? { anchor: anchorText(rootObjective, currentFocus) } : {}) };
      } catch {
        return { aligned: true, similarity: null, method: "none" };
      }
    }
    return { aligned: true, similarity: null, method: "none" };
  }
}

export function anchorText(rootObjective: string, currentFocus: string): string {
  return [
    "[🚨 COGNITIVE ALIGNMENT SENTINEL]",
    "Your current focus has drifted from the primary goal.",
    `- Core objective: "${rootObjective}"`,
    `- Current tactical drift: "${currentFocus}"`,
    "Zoom out, abandon minor side-quests, and take the next step that directly advances the core objective. If it is blocked, say so and stop.",
  ].join("\n");
}
