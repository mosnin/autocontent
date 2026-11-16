import { z } from "zod";
import { completeJson } from "../models/structured.ts";
import type { ModelProvider } from "../models/types.ts";

export interface RerankCandidate {
  text: string;
  score: number;
}

export interface Reranker {
  rerank<T extends RerankCandidate>(query: string, candidates: T[], options?: { topK?: number; threshold?: number }): Promise<T[]>;
}

/** Port for true cross-encoders (e.g. Workers AI `@cf/baai/bge-reranker-base`, Cohere, Jina). */
export type CrossEncoderFn = (query: string, documents: string[]) => Promise<number[]>;

/** The spec's pruning threshold for cross-encoder relevance, on the probability scale (L3995). */
export const DEFAULT_RERANK_THRESHOLD = 0.65;

/**
 * How raw cross-encoder scores map to a relevance probability. BGE rerankers output a logit ("the score
 * can be mapped to [0, 1] by a sigmoid", model card), other endpoints already return probabilities.
 * "auto" (default): sigmoid when any score of the batch falls outside [0, 1], else as is. "logit": always
 * sigmoid. "probability": never.
 */
export type CrossEncoderScale = "auto" | "logit" | "probability";

export function toRelevanceProbabilities(scores: number[], scale: CrossEncoderScale = "auto"): number[] {
  const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
  const logits = scale === "logit" || (scale === "auto" && scores.some((s) => Number.isFinite(s) && (s < 0 || s > 1)));
  return scores.map((s) => (Number.isFinite(s) ? (logits ? sigmoid(s) : s) : 0));
}

/**
 * Cross-encoder re-ranking: scores (query, passage) pairs jointly and drops
 * low-signal noise before it reaches the expensive model's context window.
 * Scores are compared on the probability scale (`scale`), so the default
 * threshold is the spec's 0.65 whatever the endpoint returns.
 */
export class CrossEncoderReranker implements Reranker {
  constructor(
    private readonly score: CrossEncoderFn,
    private readonly defaults: { topK?: number; threshold?: number; scale?: CrossEncoderScale } = {},
  ) {}

  async rerank<T extends RerankCandidate>(query: string, candidates: T[], options: { topK?: number; threshold?: number } = {}): Promise<T[]> {
    if (candidates.length === 0) return [];
    const topK = options.topK ?? this.defaults.topK ?? 4;
    const threshold = options.threshold ?? this.defaults.threshold ?? DEFAULT_RERANK_THRESHOLD;
    try {
      const scores = toRelevanceProbabilities(await this.score(query, candidates.map((c) => c.text)), this.defaults.scale);
      return candidates
        .map((c, i) => ({ ...c, score: scores[i] ?? c.score }))
        .filter((c) => c.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    } catch {
      return [...candidates].sort((a, b) => b.score - a.score).slice(0, topK);
    }
  }
}

const ScoresSchema = z.object({ scores: z.array(z.number().min(0).max(1)) });

/** LLM-as-reranker fallback when no cross-encoder endpoint is available. */
export class LlmReranker implements Reranker {
  constructor(private readonly model: ModelProvider) {}

  async rerank<T extends RerankCandidate>(query: string, candidates: T[], options: { topK?: number; threshold?: number } = {}): Promise<T[]> {
    if (candidates.length === 0) return [];
    const topK = options.topK ?? 4;
    try {
      const { value } = await completeJson(this.model, ScoresSchema, {
        system: "You are an information-retrieval relevance grader. Score how useful each passage is for answering the query, 0.00 (irrelevant) to 1.00 (directly answers it). Return one score per passage, in order.",
        prompt: `Query: ${query}\n\n${candidates.map((c, i) => `[${i}] ${c.text.slice(0, 700)}`).join("\n---\n")}`,
        schemaName: "rerank_scores",
      });
      return candidates
        .map((c, i) => ({ ...c, score: value.scores[i] ?? c.score }))
        .filter((c) => c.score >= (options.threshold ?? 0.35))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    } catch {
      return [...candidates].sort((a, b) => b.score - a.score).slice(0, topK);
    }
  }
}
