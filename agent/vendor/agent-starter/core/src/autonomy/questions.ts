import { AgentError } from "../errors.ts";
import { base64UrlDecode, base64UrlEncode, hmacSha256, timingSafeEqual } from "../util/crypto.ts";
import type { ApprovalSecret } from "./approvals.ts";

/**
 * Typed questions an agent asks a person (`ask_person`). Like approvals they
 * park the run; the answer comes back through a signed, expiring link
 * (`POST /answers/:token`) that wakes the agent with a `human-answer` signal.
 */
export type HumanQuestionKind = "choice" | "text" | "confirm";

export interface HumanQuestionTokenPayload {
  /** Token type marker: domain-separates question links from approval links. */
  typ: "hq";
  /** Question id. */
  qid: string;
  /** Tenant id. */
  tid: string;
  /** Run / conversation id the answer is delivered to. */
  rid: string;
  kind: HumanQuestionKind;
  /** Question text shown to the person. */
  q: string;
  /** Allowed answers for `choice`. */
  o?: string[];
  /** Expiry (epoch ms). */
  exp: number;
  /** Nonce. */
  n: string;
  /** Optional intended answerer (session `sub`); only that user (same tenant) may answer. */
  r?: string;
}

export const MAX_QUESTION_CHARS = 500;
export const MAX_CHOICE_CHARS = 120;
export const MAX_CHOICES = 10;
export const MAX_TEXT_ANSWER_CHARS = 2000;

function secrets(secret: ApprovalSecret): string[] {
  const list = (Array.isArray(secret) ? secret : [secret]).filter((s) => typeof s === "string" && s.length > 0);
  if (list.length === 0) throw new AgentError("CONFIG_INVALID", "No question signing secret configured");
  return list;
}

// Domain separation: the MAC input is prefixed so a question token can never verify as an approval token (and vice versa).
const mac = (secret: string, body: string) => hmacSha256(secret, `hq.${body}`);

export async function createHumanQuestionToken(secret: ApprovalSecret, payload: Omit<HumanQuestionTokenPayload, "typ">): Promise<string> {
  const body = base64UrlEncode(JSON.stringify({ ...payload, typ: "hq" }));
  return `${body}.${base64UrlEncode(await mac(secrets(secret)[0] as string, body))}`;
}

export async function verifyHumanQuestionToken(secret: ApprovalSecret, token: string, clock: () => number = Date.now): Promise<HumanQuestionTokenPayload> {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) throw new AgentError("APPROVAL_TOKEN_INVALID", "Malformed question token");
  let valid = false;
  for (const s of secrets(secret)) {
    if (timingSafeEqual(base64UrlEncode(await mac(s, body)), signature)) valid = true;
  }
  if (!valid) throw new AgentError("APPROVAL_TOKEN_INVALID", "Question token signature mismatch");
  let payload: HumanQuestionTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(body)) as HumanQuestionTokenPayload;
  } catch (error) {
    throw new AgentError("APPROVAL_TOKEN_INVALID", "Question token payload unreadable", { cause: error });
  }
  if (typeof payload !== "object" || payload === null || payload.typ !== "hq") throw new AgentError("APPROVAL_TOKEN_INVALID", "Not a question token");
  if (typeof payload.exp !== "number" || !(payload.exp >= clock())) throw new AgentError("APPROVAL_TOKEN_INVALID", "Question token expired");
  if (payload.kind !== "choice" && payload.kind !== "text" && payload.kind !== "confirm") throw new AgentError("APPROVAL_TOKEN_INVALID", "Question kind invalid");
  if (typeof payload.qid !== "string" || typeof payload.tid !== "string" || typeof payload.rid !== "string" || typeof payload.q !== "string") {
    throw new AgentError("APPROVAL_TOKEN_INVALID", "Question token fields invalid");
  }
  if (payload.kind === "choice" && (!Array.isArray(payload.o) || payload.o.length < 2 || !payload.o.every((o) => typeof o === "string"))) {
    throw new AgentError("APPROVAL_TOKEN_INVALID", "Choice question without options");
  }
  return payload;
}

/** The normalized answer: `choice` → one of the options, `text` → trimmed text, `confirm` → "yes" | "no". */
export interface HumanAnswer {
  questionId: string;
  kind: HumanQuestionKind;
  value: string;
}

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g;

/**
 * Validate a submitted answer against the signed question. Accepts
 * `{ answer }` (string | boolean) and, for UI compatibility, `{ decision, note }`
 * (approve = yes / note = text or choice). Throws `TOOL_VALIDATION_FAILED`.
 */
export function validateHumanAnswer(question: Pick<HumanQuestionTokenPayload, "qid" | "kind" | "o">, input: { answer?: unknown; decision?: unknown; note?: unknown }): HumanAnswer {
  const fail = (message: string) => new AgentError("TOOL_VALIDATION_FAILED", message);
  const raw = input.answer !== undefined ? input.answer : question.kind === "confirm" ? input.decision : input.note;
  if (question.kind === "confirm") {
    const text = typeof raw === "boolean" ? (raw ? "yes" : "no") : typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (["yes", "true", "approve", "y"].includes(text)) return { questionId: question.qid, kind: "confirm", value: "yes" };
    if (["no", "false", "reject", "n"].includes(text)) return { questionId: question.qid, kind: "confirm", value: "no" };
    throw fail("Answer must be yes or no.");
  }
  if (typeof raw !== "string") throw fail("Answer must be a string.");
  const value = raw.replace(CONTROL_CHARS, "").trim();
  if (question.kind === "choice") {
    const match = (question.o ?? []).find((option) => option === value);
    if (match === undefined) throw fail("Answer must be one of the offered choices.");
    return { questionId: question.qid, kind: "choice", value: match };
  }
  if (!value) throw fail("Answer must not be empty.");
  if (value.length > MAX_TEXT_ANSWER_CHARS) throw fail(`Answer must be at most ${MAX_TEXT_ANSWER_CHARS} characters.`);
  return { questionId: question.qid, kind: "text", value };
}
