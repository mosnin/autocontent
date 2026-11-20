/** PII and secret redaction for model outputs, telemetry and outbound webhooks. */
export type RedactionKind = "email" | "phone" | "credit_card" | "ssn" | "iban" | "api_key" | "jwt" | "private_key" | "ip_address";

export interface RedactionFinding {
  kind: RedactionKind;
  count: number;
}

const RULES: Array<{ kind: RedactionKind; regex: RegExp; validate?: (match: string) => boolean }> = [
  { kind: "private_key", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: "jwt", regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  {
    kind: "api_key",
    regex: /\b(?:sk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|rk_(?:live|test)_[A-Za-z0-9]{16,})\b/g,
  },
  { kind: "email", regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: "credit_card", regex: /\b(?:\d[ -]?){13,19}\b/g, validate: (m) => luhn(m.replace(/\D/g, "")) },
  { kind: "ssn", regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  { kind: "iban", regex: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g },
  { kind: "phone", regex: /(?<!\w)(?:\+?\d{1,3}[ .-]?)?(?:\(\d{2,4}\)|\d{2,4})[ .-]?\d{3,4}[ .-]?\d{3,4}(?!\w)/g, validate: (m) => m.replace(/\D/g, "").length >= 10 },
  { kind: "ip_address", regex: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
];

function luhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export interface RedactOptions {
  kinds?: RedactionKind[];
  replacement?: (kind: RedactionKind) => string;
}

export function redactSensitive(text: string, options: RedactOptions = {}): { text: string; findings: RedactionFinding[] } {
  const allowed = options.kinds ? new Set(options.kinds) : null;
  const replacement = options.replacement ?? ((kind) => `[REDACTED_${kind.toUpperCase()}]`);
  const counts = new Map<RedactionKind, number>();
  let out = text;
  for (const rule of RULES) {
    if (allowed && !allowed.has(rule.kind)) continue;
    out = out.replace(rule.regex, (match) => {
      if (rule.validate && !rule.validate(match)) return match;
      counts.set(rule.kind, (counts.get(rule.kind) ?? 0) + 1);
      return replacement(rule.kind);
    });
  }
  return { text: out, findings: [...counts].map(([kind, count]) => ({ kind, count })) };
}

/** Recursively redact secrets in structured telemetry payloads before export. */
export function redactDeep<T>(value: T, options: RedactOptions = { kinds: ["api_key", "jwt", "private_key"] }): T {
  if (typeof value === "string") return redactSensitive(value, options).text as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, options)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = /^(authorization|api[_-]?key|secret|password|token|cookie)$/i.test(key) ? "[REDACTED]" : redactDeep(v, options);
    }
    return out as T;
  }
  return value;
}
