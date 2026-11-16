import { GuardrailBlockedError, SecurityHaltError } from "../errors.ts";
import type { ModelProvider } from "../models/types.ts";
import { assessInjection, CLEANSED_MARKER, classifyInjectionWithModel, cleanseUntrustedText, type InjectionAssessment } from "./injection.ts";
import { redactSensitive, type RedactionKind } from "./pii.ts";

export type GuardrailAction = "allow" | "sanitize" | "block" | "halt";

export interface GuardrailViolation {
  guard: string;
  action: GuardrailAction;
  message: string;
  details?: Record<string, unknown>;
}

export interface GuardrailResult {
  action: GuardrailAction;
  text: string;
  violations: GuardrailViolation[];
  injection?: InjectionAssessment;
}

export interface Guard {
  name: string;
  check(text: string, context: GuardContext): Promise<{ action: GuardrailAction; text?: string; message?: string; details?: Record<string, unknown> }>;
}

export interface GuardContext {
  direction: "input" | "output";
  source: string;
  tenantId?: string;
}

export interface GuardrailPolicy {
  maxInputChars: number;
  /** Heuristic score at/above which input is cleansed. */
  sanitizeThreshold: number;
  /** Score at/above which the run halts with SECURITY_EXCEPTION_HALT. */
  haltThreshold: number;
  /** Ask a small model for borderline scores in [sanitizeThreshold, haltThreshold). */
  classifier?: ModelProvider;
  redactOutputKinds: RedactionKind[];
  blockedOutputPatterns: RegExp[];
  blockedTopics: Array<{ name: string; pattern: RegExp }>;
  customGuards: Guard[];
  /**
   * Safety fallback for outputs: when assistant text carries instruction-like
   * payloads at or above `haltThreshold` (e.g. echoed injected content headed
   * for a downstream system), the offending spans are replaced with
   * CLEANSED_MARKER ("[CLEANSED_INJECTION_ATTEMPT]"). Default true.
   */
  cleanseOutputInjection?: boolean;
}

export const DEFAULT_GUARDRAIL_POLICY: GuardrailPolicy = {
  maxInputChars: 32_000,
  sanitizeThreshold: 0.3,
  haltThreshold: 0.6,
  redactOutputKinds: ["api_key", "jwt", "private_key", "credit_card", "ssn"],
  blockedOutputPatterns: [],
  blockedTopics: [],
  customGuards: [],
};

/**
 * Input/output guardrail pipeline. Inputs: length limits, injection heuristics +
 * optional model classifier, topic blocks, custom guards. Outputs: secret/PII
 * redaction, forbidden patterns, custom guards. Violations are returned for audit.
 */
export class GuardrailPipeline {
  readonly policy: GuardrailPolicy;

  constructor(policy: Partial<GuardrailPolicy> = {}) {
    this.policy = { ...DEFAULT_GUARDRAIL_POLICY, ...policy };
  }

  async checkInput(text: string, context: Omit<GuardContext, "direction">): Promise<GuardrailResult> {
    const violations: GuardrailViolation[] = [];
    let current = text;
    let action: GuardrailAction = "allow";

    if (current.length > this.policy.maxInputChars) {
      violations.push({ guard: "length", action: "sanitize", message: `Input truncated from ${current.length} to ${this.policy.maxInputChars} chars` });
      current = current.slice(0, this.policy.maxInputChars);
      action = "sanitize";
    }

    for (const topic of this.policy.blockedTopics) {
      if (topic.pattern.test(current)) {
        violations.push({ guard: "topic", action: "block", message: `Blocked topic: ${topic.name}` });
        return { action: "block", text: current, violations };
      }
    }

    const injection = assessInjection(current);
    let injectionScore = injection.score;
    if (this.policy.classifier && injectionScore >= this.policy.sanitizeThreshold && injectionScore < this.policy.haltThreshold) {
      try {
        const verdict = await classifyInjectionWithModel(this.policy.classifier, current);
        if (verdict.injection && verdict.confidence >= 0.8) injectionScore = Math.max(injectionScore, this.policy.haltThreshold);
        violations.push({ guard: "injection-classifier", action: verdict.injection ? "sanitize" : "allow", message: verdict.reason, details: { confidence: verdict.confidence } });
      } catch (error) {
        violations.push({ guard: "injection-classifier", action: "allow", message: `Classifier unavailable: ${String(error)}` });
      }
    }

    if (injectionScore >= this.policy.haltThreshold) {
      violations.push({ guard: "prompt-injection", action: "halt", message: "Prompt injection detected", details: { score: injectionScore, signals: injection.signals } });
      return { action: "halt", text: cleanseUntrustedText(current, this.policy.maxInputChars), violations, injection };
    }
    if (injectionScore >= this.policy.sanitizeThreshold) {
      violations.push({ guard: "prompt-injection", action: "sanitize", message: "Suspicious instructions neutralized", details: { score: injectionScore, signals: injection.signals } });
      current = cleanseUntrustedText(current, this.policy.maxInputChars);
      action = "sanitize";
    }

    for (const guard of this.policy.customGuards) {
      const result = await guard.check(current, { ...context, direction: "input" });
      if (result.action !== "allow") violations.push({ guard: guard.name, action: result.action, message: result.message ?? guard.name, ...(result.details ? { details: result.details } : {}) });
      if (result.action === "halt" || result.action === "block") return { action: result.action, text: result.text ?? current, violations, injection };
      if (result.action === "sanitize") {
        current = result.text ?? current;
        action = "sanitize";
      }
    }
    return { action, text: current, violations, injection };
  }

  async checkOutput(text: string, context: Omit<GuardContext, "direction">): Promise<GuardrailResult> {
    const violations: GuardrailViolation[] = [];
    let action: GuardrailAction = "allow";
    const redacted = redactSensitive(text, { kinds: this.policy.redactOutputKinds });
    let current = redacted.text;
    if (redacted.findings.length > 0) {
      action = "sanitize";
      violations.push({ guard: "redaction", action: "sanitize", message: "Sensitive data redacted", details: { findings: redacted.findings } });
    }
    if (this.policy.cleanseOutputInjection !== false) {
      const injection = assessInjection(current);
      if (injection.score >= this.policy.haltThreshold) {
        current = cleanseUntrustedText(current, Number.MAX_SAFE_INTEGER);
        action = "sanitize";
        violations.push({ guard: "output-injection", action: "sanitize", message: `Instruction-like payload neutralized with ${CLEANSED_MARKER}`, details: { score: injection.score, signals: injection.signals.map((s) => s.pattern) } });
      }
    }
    for (const pattern of this.policy.blockedOutputPatterns) {
      if (pattern.test(current)) {
        violations.push({ guard: "output-pattern", action: "block", message: `Output matched forbidden pattern ${pattern.source}` });
        return { action: "block", text: current, violations };
      }
    }
    for (const guard of this.policy.customGuards) {
      const result = await guard.check(current, { ...context, direction: "output" });
      if (result.action !== "allow") violations.push({ guard: guard.name, action: result.action, message: result.message ?? guard.name });
      if (result.action === "halt" || result.action === "block") return { action: result.action, text: result.text ?? current, violations };
      if (result.action === "sanitize") {
        current = result.text ?? current;
        action = "sanitize";
      }
    }
    return { action, text: current, violations };
  }

  /** Convenience: throw typed errors for halt/block, return cleaned text otherwise. */
  async enforceInput(text: string, context: Omit<GuardContext, "direction">): Promise<string> {
    const result = await this.checkInput(text, context);
    if (result.action === "halt") throw new SecurityHaltError("SECURITY_EXCEPTION_HALT: untrusted input attempted to override agent instructions.", { violations: result.violations });
    if (result.action === "block") throw new GuardrailBlockedError("Input blocked by guardrail policy.", { violations: result.violations });
    return result.text;
  }

  async enforceOutput(text: string, context: Omit<GuardContext, "direction">): Promise<string> {
    const result = await this.checkOutput(text, context);
    if (result.action === "halt" || result.action === "block") throw new GuardrailBlockedError("Output blocked by guardrail policy.", { violations: result.violations });
    return result.text;
  }
}
