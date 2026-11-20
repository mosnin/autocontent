import { DEPARTMENTS, departmentById, type DepartmentId, type Department } from "@/lib/departments";

const PENDING_KEY = (id: string) => `marketer.pending.${id}`;

/** Store the first message for a conversation that's about to open. */
export function queueFirstMessage(conversationId: string, text: string, scope: DepartmentId | null) {
  try {
    sessionStorage.setItem(PENDING_KEY(conversationId), JSON.stringify({ text, scope }));
  } catch {
    /* storage unavailable: the person can resend */
  }
}

export function takeFirstMessage(conversationId: string): { text: string; scope: DepartmentId | null } | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY(conversationId));
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_KEY(conversationId));
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** A mention routes a message to one department ("@Content producer: …"); the orchestrator honours it. */
export function withScope(text: string, scope: DepartmentId | null): string {
  const d = departmentById(scope);
  return d ? `@${d.agentName}: ${text}` : text;
}

export function stripScope(text: string): { scope: Department | undefined; text: string } {
  const d = DEPARTMENTS.find((x) => text.startsWith(`@${x.agentName}: `));
  return d ? { scope: d, text: text.slice(d.agentName.length + 3) } : { scope: undefined, text };
}
