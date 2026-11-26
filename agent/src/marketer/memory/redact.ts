import { redactSensitive, type RedactionKind } from "@agent-starter/core";

/**
 * Memory never stores secrets or raw credentials (docs/memory/trust.md).
 *
 * A fact whose value contains a credential is REJECTED, not stored with a hole in it: "our API key is ..." is not a
 * marketing fact. Free-text context that travels with a fact (the source excerpt) is redacted instead. The backend
 * runs the same check again before it writes (src/marketer/repos/memory.py), so a caller that skips this module
 * still cannot store one.
 */

const KINDS: RedactionKind[] = ["api_key", "jwt", "private_key", "credit_card", "ssn", "iban"];

/** Credential shapes the shared redactor does not name: assignments, auth headers, URLs with a password, key prefixes. */
const EXTRA: readonly { kind: string; pattern: RegExp }[] = [
  { kind: "credential_assignment", pattern: /\b(?:pass(?:word|wd|phrase)?|secret|api[_ -]?key|access[_ -]?key|auth[_ -]?token|client[_ -]?secret|token)\b\s*(?:[=:]\s*\S{6,}|is\s+(?=\S*\d)\S{8,})/i },
  { kind: "authorization_header", pattern: /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{16,}/i },
  { kind: "url_credentials", pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i },
  { kind: "key_prefix", pattern: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bsk-[A-Za-z0-9_-]{20,}/ },
  { kind: "long_hex_secret", pattern: /\b[a-f0-9]{40,}\b/i },
];

/** The kinds of secret found in `text` (empty when clean). */
export function secretKinds(text: string): string[] {
  if (!text) return [];
  const kinds = new Set<string>(redactSensitive(text, { kinds: KINDS }).findings.map((f) => f.kind));
  for (const { kind, pattern } of EXTRA) if (pattern.test(text)) kinds.add(kind);
  return [...kinds];
}

export function containsSecret(text: string): boolean {
  return secretKinds(text).length > 0;
}

/** Redact secrets in context text (source excerpts). Facts themselves are rejected instead, see above. */
export function redactSecrets(text: string): string {
  let out = redactSensitive(text, { kinds: KINDS }).text;
  for (const { kind, pattern } of EXTRA) out = out.replace(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`), `[REDACTED_${kind.toUpperCase()}]`);
  return out;
}
