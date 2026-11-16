"use client";

import type { FlueConversationMessage, FlueConversationPart } from "@flue/sdk";
import { AlertTriangle, Check, ChevronRight, Loader2, PanelRight, RotateCcw, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { DEPARTMENTS, departmentById, MARKETER, type Department, type DepartmentId } from "@/lib/departments";
import { splitOpenUISegments, type ToolPart } from "@/lib/agent/parts";
import { departmentForTool, describeTool } from "@/lib/agent/tool-labels";
import type { ApprovalRequest } from "@/lib/agent/types";
import { readHumanQuestion, useApprovals, type UseApprovalsResult } from "@/lib/agent/use-approvals";
import { useAgentChat } from "@/lib/agent/use-agent-chat";
import { formatRelative } from "@/lib/format";
import { useAgent } from "./agent-provider";
import { Composer } from "./composer";
import { Markdown } from "./markdown";
import { Shader } from "../shader";
import { AgentAvatar, Badge, Button, cx, Kbd } from "../ui";

const PENDING_KEY = (id: string) => `marketer.pending.${id}`;

/** Store a first message for a conversation that's about to open (New session, Home composer). */
export function queueFirstMessage(conversationId: string, text: string, scope: DepartmentId | null) {
  try {
    sessionStorage.setItem(PENDING_KEY(conversationId), JSON.stringify({ text, scope }));
  } catch {
    /* storage unavailable: the person can resend */
  }
}

/** Mentions route a message to one department ("@Content producer …"); the orchestrator honours them. */
export function withScope(text: string, scope: DepartmentId | null): string {
  const d = departmentById(scope);
  return d ? `@${d.agentName}: ${text}` : text;
}

function stripScope(text: string): { scope: Department | undefined; text: string } {
  const d = DEPARTMENTS.find((x) => text.startsWith(`@${x.agentName}: `));
  return d ? { scope: d, text: text.slice(d.agentName.length + 3) } : { scope: undefined, text };
}

function textOf(m: FlueConversationMessage): string {
  return m.parts
    .filter((p): p is Extract<FlueConversationPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}

type Block = { kind: "text"; text: string; streaming: boolean } | { kind: "tools"; tools: ToolPart[] } | { kind: "reasoning"; text: string };

function blocksOf(m: FlueConversationMessage): Block[] {
  const out: Block[] = [];
  for (const p of m.parts) {
    if (p.type === "text") {
      const prev = out[out.length - 1];
      if (prev?.kind === "text") (prev.text += p.text), (prev.streaming = p.state === "streaming");
      else out.push({ kind: "text", text: p.text, streaming: p.state === "streaming" });
    } else if (p.type === "dynamic-tool") {
      if (p.toolName === "ask_person") continue;
      const prev = out[out.length - 1];
      if (prev?.kind === "tools") prev.tools.push(p);
      else out.push({ kind: "tools", tools: [p] });
    } else if (p.type === "reasoning" && p.text.trim()) {
      out.push({ kind: "reasoning", text: p.text });
    }
  }
  return out;
}

export function Conversation({ conversationId }: { conversationId: string }) {
  const { state, conversationUrl, threads } = useAgent();
  const ready = state.status === "ready" ? state : null;
  const chat = useAgentChat({ url: conversationUrl(conversationId), token: ready?.token });
  const approvals = useApprovals({ token: ready?.token, onDecided: () => undefined });
  const [scope, setScope] = useState<DepartmentId | null>(null);
  const [panel, setPanel] = useState(true);
  const [focusDept, setFocusDept] = useState<DepartmentId | null>(null);
  const sentFirst = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);

  // Send the queued first message exactly once.
  useEffect(() => {
    if (!chat.client || sentFirst.current) return;
    let pending: { text: string; scope: DepartmentId | null } | null = null;
    try {
      const raw = sessionStorage.getItem(PENDING_KEY(conversationId));
      if (raw) {
        pending = JSON.parse(raw);
        sessionStorage.removeItem(PENDING_KEY(conversationId));
      }
    } catch {
      /* ignore */
    }
    sentFirst.current = true;
    if (pending?.text) {
      setScope(pending.scope);
      void chat.sendMessage(withScope(pending.text, pending.scope)).then(() => threads?.refresh());
    }
  }, [chat.client, chat, conversationId, threads]);

  const visible = useMemo(() => chat.messages.filter((m) => m.display !== "hidden" && (m.role === "user" || m.role === "assistant" || m.settlement)), [chat.messages]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [visible.length, chat.status]);

  // Departments that touched this conversation, for the chips and the right panel.
  const deptSteps = useMemo(() => {
    const map = new Map<DepartmentId, ToolPart[]>();
    for (const m of chat.messages)
      for (const p of m.parts)
        if (p.type === "dynamic-tool") {
          const d = departmentForTool(p.toolName, p.input);
          if (d) map.set(d.id, [...(map.get(d.id) ?? []), p]);
        }
    return map;
  }, [chat.messages]);
  const activeDepts = DEPARTMENTS.filter((d) => deptSteps.has(d.id));
  const shownDept = departmentById(focusDept) ?? activeDepts[activeDepts.length - 1];

  const approvalsByMessage = useMemo(() => {
    const map = new Map<string, ApprovalRequest[]>();
    for (const a of chat.approvals) {
      const key = a.messageId ?? "_tail";
      map.set(key, [...(map.get(key) ?? []), approvals.resolve(a)]);
    }
    return map;
  }, [chat.approvals, approvals]);

  if (state.status === "offline") return <AgentOffline reason={state.reason} />;

  const send = (text: string, s: DepartmentId | null) => void chat.sendMessage(withScope(text, s)).then(() => threads?.refresh());
  const empty = visible.length === 0 && chat.status !== "submitted" && chat.status !== "streaming";

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[760px] px-5 pb-10 pt-8 sm:px-8">
            {(state.status === "loading" || (chat.status === "idle" && !chat.client)) && <TranscriptSkeleton />}
            {empty && chat.client && <p className="py-16 text-center text-[14px] text-muted-foreground">Ask Marketer anything. It will plan, hand work to the right department, and check with you before it spends or publishes.</p>}
            <div className="space-y-8">
              {visible.map((m) =>
                m.role === "user" ? (
                  <UserMessage key={m.id} message={m} />
                ) : m.settlement ? (
                  <div key={m.id} className="flex items-center gap-2 rounded-[14px] bg-destructive/10 px-4 py-3 text-[14px] text-destructive">
                    <AlertTriangle className="size-4" />
                    {m.settlement.outcome === "aborted" ? "Stopped." : "That turn failed."}
                    {chat.failedSends?.[0] && (
                      <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void chat.retry(chat.failedSends[0]!)}>
                        <RotateCcw /> Retry
                      </Button>
                    )}
                  </div>
                ) : (
                  <AssistantMessage key={m.id} message={m} approvals={approvalsByMessage.get(m.id) ?? []} decider={approvals} onFocusDept={(d) => (setFocusDept(d), setPanel(true))} />
                ),
              )}
              {(approvalsByMessage.get("_tail") ?? []).map((a) => (
                <ApprovalBlock key={a.approvalId} approval={a} decider={approvals} />
              ))}
              {chat.status === "submitted" && (
                <div className="flex items-center gap-2.5">
                  <AgentAvatar name={MARKETER.name} palette={MARKETER.palette} size={26} working />
                  <span className="t-shimmer text-[14px]">Thinking</span>
                </div>
              )}
              {chat.isBusy && activeDepts.length > 0 && (
                <div>
                  <div className="mb-2 text-[13px] text-muted-foreground">Agents working</div>
                  <div className="flex flex-wrap gap-1.5">
                    {activeDepts.map((d) => (
                      <button key={d.id} type="button" onClick={() => (setFocusDept(d.id), setPanel(true))} className={cx("press flex h-8 items-center gap-1.5 rounded-full border border-border bg-card pl-1 pr-3 text-[13px] hover:bg-muted", shownDept?.id === d.id && panel && "bg-muted")}>
                        <AgentAvatar name={d.agentName} palette={d.palette} size={22} />
                        {d.agentName}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div ref={bottom} />
          </div>
        </div>
        <div className="shrink-0 px-4 pb-4 sm:px-8">
          <div className="mx-auto max-w-[760px]">
            {chat.error && <p className="mb-2 text-[13px] text-destructive">{chat.error.message}</p>}
            <Composer onSubmit={send} scope={scope} onScopeChange={setScope} busy={chat.isBusy} onStop={() => void chat.stop()} disabled={!chat.client} />
          </div>
        </div>
      </div>

      {/* Right panel: the active department's trace */}
      {activeDepts.length > 0 && (
        <>
          <button type="button" onClick={() => setPanel((v) => !v)} className="press absolute right-4 top-[9px] hidden size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted lg:flex" aria-label={panel ? "Hide agent panel" : "Show agent panel"} title={panel ? "Hide agent panel" : "Show agent panel"}>
            <PanelRight className="size-4" />
          </button>
          {panel && shownDept && (
            <aside className="t-enter hidden w-[340px] shrink-0 overflow-y-auto border-l border-border lg:block">
              <div className="flex h-[50px] items-center gap-2 border-b border-border px-4 text-[14px]">
                <span className="text-muted-foreground">Agents</span>
                <span className="text-faint">/</span>
                <AgentAvatar name={shownDept.agentName} palette={shownDept.palette} size={20} />
                <span className="font-medium">{shownDept.agentName}</span>
                <button type="button" onClick={() => setPanel(false)} className="press ml-auto flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted" aria-label="Close panel" title="Close panel">
                  <X className="size-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-3">
                {activeDepts.map((d) => (
                  <button key={d.id} type="button" onClick={() => setFocusDept(d.id)} className={cx("press flex h-7 items-center gap-1.5 rounded-full pl-0.5 pr-2.5 text-[12px]", d.id === shownDept.id ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted")}>
                    <AgentAvatar name={d.agentName} palette={d.palette} size={20} />
                    {d.label}
                  </button>
                ))}
              </div>
              <div className="px-4 py-4">
                <Trace tools={deptSteps.get(shownDept.id) ?? []} defaultOpen />
                <Link href={shownDept.href} className="mt-4 flex items-center gap-1 text-[13px] text-accent hover:underline">
                  Open {shownDept.label} <ChevronRight className="size-3.5" />
                </Link>
              </div>
            </aside>
          )}
        </>
      )}
    </div>
  );
}

function UserMessage({ message }: { message: FlueConversationMessage }) {
  const { scope, text } = stripScope(textOf(message));
  return (
    <div className="t-enter flex flex-col items-end gap-1">
      {scope && (
        <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
          to <AgentAvatar name={scope.agentName} palette={scope.palette} size={16} /> {scope.agentName}
        </span>
      )}
      <div className="max-w-[85%] whitespace-pre-wrap rounded-[20px] bg-muted px-4 py-2.5 text-[15px] leading-relaxed">{text}</div>
    </div>
  );
}

function AssistantMessage({ message, approvals, decider, onFocusDept }: { message: FlueConversationMessage; approvals: ApprovalRequest[]; decider: UseApprovalsResult; onFocusDept: (d: DepartmentId) => void }) {
  const blocks = blocksOf(message);
  return (
    <div className="t-enter">
      <div className="mb-2 flex items-center gap-2.5">
        <AgentAvatar name={MARKETER.name} palette={MARKETER.palette} size={26} />
        <span className="text-[14px] font-medium">Marketer</span>
        {message.timestamp && <span className="text-[12px] text-faint">{formatRelative(message.timestamp)}</span>}
      </div>
      <div className="space-y-3 pl-[36px]">
        {blocks.map((b, i) =>
          b.kind === "text" ? (
            <TextBlock key={i} text={b.text} />
          ) : b.kind === "reasoning" ? (
            <details key={i} className="group text-[13px] text-muted-foreground">
              <summary className="flex cursor-pointer list-none items-center gap-1.5">
                <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" /> Thought it through
              </summary>
              <p className="mt-1.5 whitespace-pre-wrap pl-5">{b.text}</p>
            </details>
          ) : (
            <Trace key={i} tools={b.tools} onFocusDept={onFocusDept} />
          ),
        )}
        {approvals.map((a) => (
          <ApprovalBlock key={a.approvalId} approval={a} decider={decider} />
        ))}
      </div>
    </div>
  );
}

function TextBlock({ text }: { text: string }) {
  const segments = splitOpenUISegments(text);
  return (
    <>
      {segments.map((s, i) =>
        s.kind === "markdown" ? (
          s.text.trim() ? <Markdown key={i} text={s.text} /> : null
        ) : (
          <GenerativeBlock key={i} source={s.source} complete={s.complete} />
        ),
      )}
    </>
  );
}

/**
 * OpenUI blocks (plans, step lists) from the agent's generative UI. We render
 * the list-shaped ones as a plan card; anything else falls back to its text.
 */
function GenerativeBlock({ source, complete }: { source: string; complete: boolean }) {
  const lines = source
    .split("\n")
    .map((l) => l.replace(/^[\s\-*\d.)]+/, "").replace(/["{}[\]]/g, "").trim())
    .filter((l) => l && !/^[A-Za-z]+\s*=\s*[A-Za-z]+\(/.test(l));
  return (
    <div className="rounded-[20px] border border-border bg-card p-1.5">
      <div className="flex items-center gap-2 px-3 py-2 text-[14px] font-medium">
        <IconDot />
        Plan
        {!complete && <Loader2 className="size-3.5 animate-spin text-faint" />}
        <span className="ml-auto text-[12px] font-normal text-faint">{lines.length} steps</span>
      </div>
      <ol className="space-y-0.5 rounded-[14px] bg-subtle px-3 py-2">
        {lines.map((l, i) => (
          <li key={i} className="flex items-start gap-2.5 py-1 text-[14px]">
            <span className="mt-[3px] size-3.5 shrink-0 rounded-full border-[1.5px] border-faint" />
            {l}
          </li>
        ))}
      </ol>
    </div>
  );
}

function IconDot() {
  return <span aria-hidden className="size-2 rounded-full bg-accent" />;
}

/** "Worked for 12s": the steps behind a reply, each attributed to its department. */
function Trace({ tools, onFocusDept, defaultOpen }: { tools: ToolPart[]; onFocusDept?: (d: DepartmentId) => void; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const running = tools.some((t) => t.state === "input-available");
  const ms = tools.reduce((s, t) => s + (("durationMs" in t && t.durationMs) || 0), 0);
  const depts = Array.from(new Set(tools.map((t) => departmentForTool(t.toolName, t.input)).filter(Boolean))) as Department[];
  if (tools.length === 0) return <p className="text-[13px] text-muted-foreground">No steps yet.</p>;
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground" aria-expanded={open}>
        <ChevronRight className={cx("size-3.5 transition-transform duration-200", open && "rotate-90")} />
        {running ? <span className="t-shimmer">Working</span> : <span>Worked{ms > 0 ? ` for ${formatMs(ms)}` : ""}</span>}
        <span className="text-faint">· {tools.length} step{tools.length === 1 ? "" : "s"}</span>
        {!open && depts.length > 0 && (
          <span className="ml-1 flex -space-x-1">
            {depts.map((d) => (
              <AgentAvatar key={d.id} name={d.agentName} palette={d.palette} size={16} />
            ))}
          </span>
        )}
      </button>
      {open && (
        <ol className="t-enter mt-2 space-y-0.5 border-l border-border pl-3.5">
          {tools.map((t) => {
            const d = departmentForTool(t.toolName, t.input);
            return (
              <li key={t.toolCallId} className="flex items-start gap-2 py-1 text-[13px]">
                <span className="mt-[3px]">
                  {t.state === "input-available" ? <Loader2 className="size-3.5 animate-spin text-faint" /> : t.state === "output-error" ? <X className="size-3.5 text-destructive" /> : <Check className="size-3.5 text-floor" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-foreground">{describeTool(t.toolName, t.input)}</span>
                  {t.state === "output-error" && <span className="block text-destructive">{t.errorText}</span>}
                </span>
                {d && (
                  <button type="button" onClick={() => onFocusDept?.(d.id)} className="shrink-0 text-[12px] text-faint hover:text-foreground" disabled={!onFocusDept}>
                    {d.label}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function formatMs(ms: number) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

function summarizeArgs(args: unknown): [string, string][] {
  if (!args || typeof args !== "object") return [];
  return Object.entries(args as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .slice(0, 6)
    .map(([k, v]) => [k.replace(/_/g, " "), typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 120)]);
}

function ApprovalBlock({ approval, decider }: { approval: ApprovalRequest; decider: UseApprovalsResult }) {
  const question = readHumanQuestion(approval);
  if (question) return <QuestionCard approval={approval} decider={decider} />;
  const d = departmentForTool(approval.tool, approval.args);
  const pending = approval.status === "PENDING_APPROVAL";
  const busy = decider.isPending(approval.approvalId);
  const err = decider.errors[approval.approvalId];
  const high = /high|critical/i.test(approval.riskTier);
  return (
    <div className="t-enter overflow-hidden rounded-[20px] border border-border bg-card">
      <div className="flex items-center gap-3 px-4 pb-2 pt-3.5">
        <span className="relative size-9 shrink-0 overflow-hidden rounded-lg">
          <Shader palette={d?.palette ?? "mono"} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium">{describeTool(approval.tool, approval.args)}</div>
          <div className="text-[13px] text-muted-foreground">{d ? `${d.agentName} needs your go-ahead` : "Needs your go-ahead"}</div>
        </div>
        <Badge tone={high ? "warn" : "muted"}>
          <ShieldCheck /> {approval.riskTier.toLowerCase()}
        </Badge>
      </div>
      {approval.reason && <p className="px-4 text-[14px] text-muted-foreground">{approval.reason}</p>}
      {summarizeArgs(approval.args).length > 0 && (
        <dl className="mx-4 mt-3 divide-y divide-border rounded-[14px] bg-subtle text-[13px] shadow-[inset_0_0_0_1px_hsl(var(--border))]">
          {summarizeArgs(approval.args).map(([k, v]) => (
            <div key={k} className="flex gap-3 px-3 py-2">
              <dt className="w-28 shrink-0 capitalize text-muted-foreground">{k}</dt>
              <dd className="min-w-0 break-words tabular">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex items-center justify-end gap-2 px-4 py-3">
        {err && <span className="mr-auto text-[13px] text-destructive">{err.message}</span>}
        {pending ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => void decider.decide(approval, "reject")} disabled={busy}>
              Dismiss
            </Button>
            <Button size="sm" variant="primary" onClick={() => void decider.decide(approval, "approve")} loading={busy && decider.pending[approval.approvalId] === "approve"}>
              Approve & Run
            </Button>
          </>
        ) : (
          <Badge tone={approval.status === "APPROVED" ? "live" : "muted"}>{approval.status === "APPROVED" ? "Approved" : approval.status === "REJECTED" ? "Dismissed" : "Expired"}</Badge>
        )}
      </div>
    </div>
  );
}

/** ask_person: numbered answers (number keys pick), "Type your own", Enter sends. */
function QuestionCard({ approval, decider }: { approval: ApprovalRequest; decider: UseApprovalsResult }) {
  const q = readHumanQuestion(approval)!;
  const answered = decider.answers[approval.approvalId] ?? q.answer;
  const [sel, setSel] = useState(0);
  const [own, setOwn] = useState("");
  const options = q.kind === "confirm" ? ["Yes", "No"] : (q.options ?? []);
  const send = (value: string | boolean) => void decider.answer(approval, value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (answered) return;
    const el = ref.current;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA" || (e.target as HTMLElement)?.tagName === "INPUT") return;
      const n = Number(e.key);
      if (n >= 1 && n <= options.length) {
        setSel(n - 1);
        send(q.kind === "confirm" ? n === 1 : options[n - 1]!);
      }
      if (e.key === "ArrowDown") setSel((v) => Math.min(v + 1, options.length));
      if (e.key === "ArrowUp") setSel((v) => Math.max(v - 1, 0));
    };
    el?.addEventListener("keydown", onKey);
    return () => el?.removeEventListener("keydown", onKey);
  });

  return (
    <div ref={ref} tabIndex={-1} className="t-enter rounded-[20px] border border-border bg-subtle p-1.5 outline-none">
      <div className="px-3.5 pb-2 pt-2 text-[15px] font-medium">{q.question}</div>
      <div className="rounded-[14px] bg-card p-1.5 shadow-[0_0_0_0.5px_rgb(0_0_0/0.06),0_1px_2px_rgb(0_0_0/0.04)] dark:shadow-[inset_0_0_0_1px_hsl(var(--border))]">
        {answered ? (
          <div className="flex items-center gap-2 px-2.5 py-2 text-[14px]">
            <Check className="size-4 text-floor" /> {answered}
          </div>
        ) : (
          <>
            {q.kind !== "text" &&
              options.map((o, i) => (
                <button key={o} type="button" onMouseEnter={() => setSel(i)} onClick={() => send(q.kind === "confirm" ? i === 0 : o)} className={cx("flex h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[15px]", sel === i && "bg-muted")}>
                  <span className="flex size-6 items-center justify-center rounded-[6px] bg-muted text-[12px] text-muted-foreground tabular">{i + 1}</span>
                  {o}
                </button>
              ))}
            {q.kind !== "confirm" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (own.trim()) send(own.trim());
                }}
                className={cx("flex h-11 items-center gap-3 rounded-lg px-2.5", sel === options.length && "bg-muted")}
              >
                <span className="flex size-6 items-center justify-center rounded-[6px] bg-muted text-[12px] text-muted-foreground tabular">{options.length + 1}</span>
                <input value={own} onChange={(e) => setOwn(e.target.value)} onFocus={() => setSel(options.length)} placeholder={q.placeholder ?? "Type your own"} className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint" aria-label="Your answer" />
              </form>
            )}
            <div className="flex items-center gap-2 px-2.5 pb-1 pt-2 text-[12px] text-faint">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> to navigate · <Kbd>1</Kbd>–<Kbd>{Math.max(1, options.length)}</Kbd> to pick
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TranscriptSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="ml-auto h-10 w-2/3 rounded-[20px] bg-muted" />
      <div className="space-y-2">
        <div className="h-4 w-1/3 rounded-full bg-muted" />
        <div className="h-4 w-5/6 rounded-full bg-muted" />
        <div className="h-4 w-2/3 rounded-full bg-muted" />
      </div>
    </div>
  );
}

/** Shown when the agent harness isn't configured or reachable. The rest of the app still works. */
export function AgentOffline({ reason }: { reason: "not-configured" | "error" }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="t-enter w-full max-w-[420px] overflow-hidden rounded-[20px] border border-border bg-card shadow-float">
        <div className="h-[132px]">
          <Shader palette="dusk" />
        </div>
        <div className="p-6">
          <h2 className="text-[19px] font-medium tracking-[-0.015em]">{reason === "not-configured" ? "Marketer's agents aren't connected yet" : "Can't reach Marketer's agents"}</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
            {reason === "not-configured"
              ? "Conversations run on the agent harness in agent/. Set NEXT_PUBLIC_AGENT_ORIGIN and SESSION_SIGNING_SECRET for the web app, then reload."
              : "The agent harness didn't answer. Everything else keeps working; try again in a moment."}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/inbox" className="press inline-flex h-9 items-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground">
              Open inbox
            </Link>
            <Link href="/analytics" className="press inline-flex h-9 items-center rounded-full border border-border px-4 text-sm font-medium hover:bg-muted">
              See analytics
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
