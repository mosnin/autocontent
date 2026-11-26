import { useCallback, useRef, useState } from "react";
import { approvalStatusSchema } from "../internal/parts.ts";
import type { ApprovalDecision, ApprovalRequest, ApprovalStatus } from "../types.ts";

export interface UseApprovalsOptions {
  /**
   * Base URL of the approvals API; decisions POST to
   * `${endpoint}/${approvalId}` when an approval carries no signed
   * `approveUrl`/`rejectUrl`.
   */
  endpoint?: string;
  /** Custom fetch (auth wrappers, tests). Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Bearer token sent as `Authorization`. */
  token?: string;
  /** Extra request headers, static or resolved per request. */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  /** Fetch credentials mode. Default `same-origin`. */
  credentials?: RequestCredentials;
  /** Called after the server accepts a decision. */
  onDecided?: (result: ApprovalDecisionResult) => void;
}

export interface ApprovalDecisionResult {
  approvalId: string;
  decision: ApprovalDecision;
  /** Final status reported by the server (or implied by the decision). */
  status: ApprovalStatus;
  /** Parsed response body. */
  response: unknown;
}

/** A decision request the server refused. */
export class ApprovalDecisionError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApprovalDecisionError";
    this.status = status;
    this.body = body;
  }
}

export interface UseApprovalsResult {
  /**
   * POSTs `{ decision, note? }` to the approval's signed link (or
   * `${endpoint}/${approvalId}`). Concurrent calls for the same approval
   * share one request.
   */
  decide(approval: ApprovalRequest, decision: ApprovalDecision, note?: string): Promise<ApprovalDecisionResult>;
  /** In-flight decisions by approval id. */
  pending: Readonly<Record<string, ApprovalDecision>>;
  isPending(approvalId: string): boolean;
  /** Final statuses confirmed by this client, by approval id. */
  statuses: Readonly<Record<string, ApprovalStatus>>;
  /** Latest failure by approval id (cleared on the next attempt). */
  errors: Readonly<Record<string, Error>>;
  /** Overlays a locally confirmed decision onto an approval the stream still reports as pending. */
  resolve<T extends ApprovalRequest>(approval: T): T;
  /**
   * Answer an `ask_person` question: POSTs `{ answer }` to its signed link.
   * `decide()` also works for questions (confirm: approve = yes, reject = no;
   * choice/text: the note is the answer).
   */
  answer(approval: ApprovalRequest, value: string | boolean): Promise<ApprovalDecisionResult>;
  /** Answers confirmed by this client, by question (approval) id. */
  answers: Readonly<Record<string, string>>;
}

/**
 * A typed question from the agent's `ask_person` tool. It streams on the
 * approval channel as `{ tool: "ask_person", args: { type: "human-question", … } }`
 * so every surface that renders approvals also renders questions.
 */
export interface HumanQuestion {
  questionId: string;
  kind: "choice" | "text" | "confirm";
  question: string;
  options?: string[];
  placeholder?: string;
  /** Signed answer link (`POST /answers/:token`). */
  answerUrl: string;
  /** Set once the person answered. */
  answer?: string;
  answeredBy?: string;
}

/** The question carried by an approval-shaped part, or null for a regular approval. */
export function readHumanQuestion(approval: Pick<ApprovalRequest, "tool" | "args" | "approveUrl">): HumanQuestion | null {
  if (approval.tool !== "ask_person" || !isRecord(approval.args) || approval.args.type !== "human-question") return null;
  const a = approval.args;
  const kind = a.kind === "choice" || a.kind === "text" || a.kind === "confirm" ? a.kind : null;
  if (!kind || typeof a.question !== "string" || typeof a.questionId !== "string") return null;
  const options = Array.isArray(a.options) ? a.options.filter((o): o is string => typeof o === "string") : undefined;
  if (kind === "choice" && (!options || options.length < 2)) return null;
  const answerUrl = typeof a.answerUrl === "string" && a.answerUrl ? a.answerUrl : (approval.approveUrl ?? "");
  return {
    questionId: a.questionId,
    kind,
    question: a.question,
    ...(options ? { options } : {}),
    ...(typeof a.placeholder === "string" ? { placeholder: a.placeholder } : {}),
    answerUrl,
    ...(typeof a.answer === "string" && a.answer ? { answer: a.answer } : {}),
    ...(typeof a.answeredBy === "string" ? { answeredBy: a.answeredBy } : {}),
  };
}

/** Where a decision is sent: the signed per-decision link, else the REST endpoint. */
export function approvalDecisionUrl(approval: ApprovalRequest, decision: ApprovalDecision, endpoint?: string): string | undefined {
  const question = readHumanQuestion(approval);
  if (question?.answerUrl) return question.answerUrl;
  const signed = decision === "approve" ? approval.approveUrl : approval.rejectUrl;
  if (signed) return signed;
  if (endpoint) return `${endpoint.replace(/\/+$/, "")}/${encodeURIComponent(approval.approvalId)}`;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function statusFromBody(body: unknown): ApprovalStatus | undefined {
  if (!isRecord(body)) return undefined;
  for (const candidate of [body.status, isRecord(body.record) ? body.record.status : undefined, isRecord(body.approval) ? body.approval.status : undefined]) {
    const parsed = approvalStatusSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

function errorMessage(body: unknown, status: number): string {
  if (isRecord(body)) {
    if (isRecord(body.error) && typeof body.error.message === "string") return body.error.message;
    if (typeof body.error === "string") return body.error;
    if (typeof body.message === "string") return body.message;
  }
  if (typeof body === "string" && body.trim()) return body.trim().slice(0, 300);
  return `Approval request failed with HTTP ${status}`;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

/** Submits human approve/reject decisions (and `ask_person` answers) and tracks their in-flight and final state. */
export function useApprovals(options: UseApprovalsOptions = {}): UseApprovalsResult {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [pending, setPending] = useState<Record<string, ApprovalDecision>>({});
  const [statuses, setStatuses] = useState<Record<string, ApprovalStatus>>({});
  const [errors, setErrors] = useState<Record<string, Error>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const inflight = useRef(new Map<string, Promise<ApprovalDecisionResult>>());

  const submit = useCallback((approval: ApprovalRequest, decision: ApprovalDecision, note: string | undefined, answerValue: string | boolean | undefined) => {
    const existing = inflight.current.get(approval.approvalId);
    if (existing) return existing;
    const { endpoint, token, credentials, onDecided } = optionsRef.current;
    const question = readHumanQuestion(approval);
    const url = approvalDecisionUrl(approval, decision, endpoint);
    if (!url) {
      return Promise.reject(new Error(`No approval URL for ${approval.approvalId}: pass \`endpoint\` or stream approveUrl/rejectUrl`));
    }
    const doFetch = optionsRef.current.fetch ?? globalThis.fetch.bind(globalThis);
    setPending((previous) => ({ ...previous, [approval.approvalId]: decision }));
    setErrors((previous) => without(previous, approval.approvalId));

    const request = (async (): Promise<ApprovalDecisionResult> => {
      const headerOption = optionsRef.current.headers;
      const extraHeaders = typeof headerOption === "function" ? await headerOption() : (headerOption ?? {});
      const response = await doFetch(url, {
        method: "POST",
        credentials: credentials ?? "same-origin",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...extraHeaders,
        },
        body: JSON.stringify(question ? { answer: answerValue ?? (question.kind === "confirm" ? decision === "approve" : (note?.trim() ?? "")) } : { decision, ...(note?.trim() ? { note: note.trim() } : {}) }),
      });
      const body = await readBody(response);
      if (!response.ok) throw new ApprovalDecisionError(errorMessage(body, response.status), response.status, body);
      if (question) {
        const answered = isRecord(body) && typeof body.answer === "string" ? body.answer : typeof answerValue === "boolean" ? (answerValue ? "yes" : "no") : String(answerValue ?? note ?? "");
        setAnswers((previous) => ({ ...previous, [approval.approvalId]: answered }));
      }
      return {
        approvalId: approval.approvalId,
        decision,
        // A question has no approve/reject outcome: once answered it is resolved ("APPROVED" in the shared status vocabulary).
        status: question ? "APPROVED" : (statusFromBody(body) ?? (decision === "approve" ? "APPROVED" : "REJECTED")),
        response: body,
      };
    })();

    inflight.current.set(approval.approvalId, request);
    request.then(
      (result) => {
        setStatuses((previous) => ({ ...previous, [result.approvalId]: result.status }));
        onDecided?.(result);
      },
      (cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        setErrors((previous) => ({ ...previous, [approval.approvalId]: error }));
      },
    ).finally(() => {
      inflight.current.delete(approval.approvalId);
      setPending((previous) => without(previous, approval.approvalId));
    });
    return request;
  }, []);

  const decide = useCallback((approval: ApprovalRequest, decision: ApprovalDecision, note?: string) => submit(approval, decision, note, undefined), [submit]);
  const answer = useCallback(
    (approval: ApprovalRequest, value: string | boolean) => submit(approval, value === false || value === "no" ? "reject" : "approve", typeof value === "string" ? value : undefined, value),
    [submit],
  );

  const isPending = useCallback((approvalId: string) => approvalId in pending, [pending]);

  const resolve = useCallback(
    <T extends ApprovalRequest>(approval: T): T => {
      const local = statuses[approval.approvalId];
      return local && approval.status === "PENDING_APPROVAL" ? { ...approval, status: local } : approval;
    },
    [statuses],
  );

  return { decide, answer, answers, pending, isPending, statuses, errors, resolve };
}
