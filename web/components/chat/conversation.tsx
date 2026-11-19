"use client";

import type { FlueConversationMessage, FlueConversationPart } from "@flue/sdk";
import { ChevronRight, PanelRight, RotateCcw, ShieldCheck, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AgentSplit,
  AgentGlyph,
  AssistantHeader,
  Button,
  ButtonLink,
  Callout,
  Card,
  Composer,
  cx,
  IconButton,
  Markdown,
  Notice,
  PageHeader,
  PlanCard,
  QuestionCard,
  Skeleton,
  StatusBadge,
  Trace,
  type TraceNode,
  UserBubble,
  WorkedFor,
} from "@/design-system";
import { DEPARTMENTS, departmentById, type Department, type DepartmentId } from "@/lib/departments";
import { splitOpenUISegments, type ToolPart } from "@/lib/agent/parts";
import { departmentForTool, describeTool } from "@/lib/agent/tool-labels";
import type { ApprovalRequest } from "@/lib/agent/types";
import { readHumanQuestion, useApprovals, type UseApprovalsResult } from "@/lib/agent/use-approvals";
import { useAgentChat } from "@/lib/agent/use-agent-chat";
import { formatRelative } from "@/lib/format";
import { TOOL_ICON } from "../shell/sidebar";
import { useAgent } from "./agent-provider";
import { AgentPicker } from "./agent-picker";
import { collectNames, formatApprovalArgs } from "./approval-format";
import { stripScope, takeFirstMessage, withScope } from "./session-queue";

const toneOf = (d: Department | undefined) => (d ? TOOL_ICON[d.id].tone : undefined);

function textOf(m: FlueConversationMessage): string {
  return m.parts
    .filter((p): p is Extract<FlueConversationPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}

type Block = { kind: "text"; text: string } | { kind: "tools"; tools: ToolPart[] } | { kind: "reasoning"; text: string };

function blocksOf(m: FlueConversationMessage): Block[] {
  const out: Block[] = [];
  for (const p of m.parts) {
    if (p.type === "text") {
      const prev = out[out.length - 1];
      if (prev?.kind === "text") prev.text += p.text;
      else out.push({ kind: "text", text: p.text });
    } else if (p.type === "dynamic-tool") {
      if (p.toolName === "ask_person") continue;
      const prev = out[out.length - 1];
      if (prev?.kind === "tools") prev.tools.push(p);
      else out.push({ kind: "tools", tools: [p] });
    } else if (p.type === "reasoning" && p.text.trim()) out.push({ kind: "reasoning", text: p.text });
  }
  return out;
}

const traceNodes = (tools: ToolPart[]): TraceNode[] =>
  tools.map((t) => ({
    id: t.toolCallId,
    label: describeTool(t.toolName, t.input),
    state: t.state === "input-available" ? "active" : t.state === "output-error" ? "failed" : "done",
    detail: t.state === "output-error" ? <span className="text-negative">{t.errorText}</span> : undefined,
  }));

function formatMs(ms: number) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

/**
 * A session (ref 02): breadcrumb header, the chat column with the composer
 * pinned to the bottom, and the right agent panel with the active agent's trace.
 */
export function Conversation({ conversationId, title, onDelete }: { conversationId: string; title: string; onDelete?: () => void }) {
  const { state, conversationUrl, threads } = useAgent();
  const ready = state.status === "ready" ? state : null;
  const chat = useAgentChat({ url: conversationUrl(conversationId), token: ready?.token });
  const approvals = useApprovals({ token: ready?.token, onDecided: () => undefined });
  const [scope, setScope] = useState<DepartmentId | null>(null);
  const sentFirst = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);

  // Send the queued first message exactly once.
  useEffect(() => {
    if (!chat.client || sentFirst.current) return;
    sentFirst.current = true;
    const pending = takeFirstMessage(conversationId);
    if (pending?.text) {
      setScope(pending.scope);
      void chat.sendMessage(withScope(pending.text, pending.scope)).then(() => threads?.refresh());
    }
  }, [chat.client, chat, conversationId, threads]);

  const visible = useMemo(() => chat.messages.filter((m) => m.display !== "hidden" && (m.role === "user" || m.role === "assistant" || m.settlement)), [chat.messages]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [visible.length, chat.status]);

  // Departments that touched this conversation: the chips and the right panel.
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
  const approvalsByMessage = useMemo(() => {
    const map = new Map<string, ApprovalRequest[]>();
    for (const a of chat.approvals) {
      const key = a.messageId ?? "_tail";
      map.set(key, [...(map.get(key) ?? []), approvals.resolve(a)]);
    }
    return map;
  }, [chat.approvals, approvals]);

  if (state.status === "offline")
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader crumbs={[{ label: "Chat", href: "/home" }, { label: title }]} />
        <AgentOffline reason={state.reason} />
      </div>
    );

  return (
    <ChatLayout
      title={title}
      onDelete={onDelete}
      loading={state.status === "loading" || (chat.status === "idle" && !chat.client)}
      connected={Boolean(chat.client)}
      messages={visible}
      approvalsFor={(id) => approvalsByMessage.get(id) ?? []}
      decider={approvals}
      thinking={chat.status === "submitted"}
      streaming={chat.status === "streaming"}
      busy={chat.isBusy}
      deptSteps={deptSteps}
      error={chat.error?.message}
      onRetry={chat.failedSends?.[0] ? () => void chat.retry(chat.failedSends[0]!) : undefined}
      scope={scope}
      onScope={setScope}
      onSend={(text) => void chat.sendMessage(withScope(text, scope)).then(() => threads?.refresh())}
      onStop={() => void chat.stop()}
      bottomRef={bottom}
    />
  );
}

/** The session screen itself (ref 02), driven by props so it renders the same from live chat or fixtures. */
export function ChatLayout({
  title,
  onDelete,
  loading,
  connected,
  messages,
  approvalsFor,
  decider,
  thinking,
  streaming,
  busy,
  deptSteps,
  error,
  onRetry,
  scope,
  onScope,
  onSend,
  onStop,
  bottomRef,
}: {
  title: string;
  onDelete?: () => void;
  loading?: boolean;
  connected: boolean;
  messages: FlueConversationMessage[];
  /** Approvals by message id; "_tail" for ones not tied to a message. */
  approvalsFor: (messageId: string) => ApprovalRequest[];
  decider: UseApprovalsResult;
  thinking?: boolean;
  streaming?: boolean;
  busy?: boolean;
  deptSteps: Map<DepartmentId, ToolPart[]>;
  error?: string;
  onRetry?: () => void;
  scope: DepartmentId | null;
  onScope: (d: DepartmentId | null) => void;
  onSend: (text: string) => void;
  onStop?: () => void;
  bottomRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const [panel, setPanel] = useState(true);
  const [focusDept, setFocusDept] = useState<DepartmentId | null>(null);
  const activeDepts = DEPARTMENTS.filter((d) => deptSteps.has(d.id));
  const shownDept = departmentById(focusDept) ?? activeDepts[activeDepts.length - 1];
  const showPanel = panel && Boolean(shownDept);
  const empty = messages.length === 0 && !thinking && !streaming;
  const scoped = departmentById(scope);
  // Names the agent has already looked up in this conversation (campaigns, playbooks…), so approvals show them instead of ids.
  const names = useMemo(() => {
    const out: Record<string, string> = {};
    for (const m of messages) for (const p of m.parts) if (p.type === "dynamic-tool" && "output" in p) collectNames(p.output, out);
    return out;
  }, [messages]);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          crumbs={[{ label: "Chat", href: "/home" }, { label: title }]}
          menu
          actions={
            <>
              {activeDepts.length > 0 && (
                <IconButton label={panel ? "Hide agent panel" : "Show agent panel"} active={showPanel} onClick={() => setPanel((v) => !v)} className="hidden lg:flex">
                  <PanelRight />
                </IconButton>
              )}
              {onDelete && (
                <IconButton label="Delete session" onClick={onDelete}>
                  <Trash2 />
                </IconButton>
              )}
            </>
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[720px] px-5 pb-10 pt-6">
            {loading && <TranscriptSkeleton />}
            {empty && connected && <p className="py-16 text-center text-[13px] text-fg-muted">Ask Marketer anything. It plans, hands work to the right agent, and checks with you before it spends or publishes.</p>}
            <div className="space-y-7">
              {messages.map((m) =>
                m.role === "user" ? (
                  <UserMessage key={m.id} message={m} />
                ) : m.settlement ? (
                  <Callout
                    key={m.id}
                    tone="negative"
                    title={m.settlement.outcome === "aborted" ? "Stopped" : "That turn failed"}
                    action={
                      onRetry ? (
                        <Button size="sm" variant="secondary" onClick={onRetry}>
                          <RotateCcw /> Retry
                        </Button>
                      ) : undefined
                    }
                  />
                ) : (
                  <AssistantMessage key={m.id} message={m} approvals={approvalsFor(m.id)} decider={decider} names={names} />
                ),
              )}
              {approvalsFor("_tail").map((a) => (
                <ApprovalBlock key={a.approvalId} approval={a} decider={decider} names={names} />
              ))}
              {thinking && (
                <div className="flex items-center gap-2">
                  <AgentGlyph size={18} />
                  <span className="ds-shimmer text-[13px]">Thinking</span>
                </div>
              )}
              <AgentSplit
                agents={activeDepts.map((d) => ({ name: d.agentName, tone: toneOf(d) }))}
                working={Boolean(busy)}
                activeName={showPanel ? shownDept?.agentName : undefined}
                onSelect={(name) => {
                  const d = DEPARTMENTS.find((x) => x.agentName === name);
                  if (d) (setFocusDept(d.id), setPanel(true));
                }}
              />
            </div>
            <div ref={bottomRef} />
          </div>
        </div>
        <div className="shrink-0 px-4 pb-4">
          <div className="mx-auto max-w-[720px]">
            {error && (
              <div className="mb-2">
                <Notice error={error} />
              </div>
            )}
            <Composer
              agent={{ name: scoped?.agentName ?? "Marketer", note: scoped ? scoped.label : "Routes each request", tone: toneOf(scoped) }}
              agentPicker={<AgentPicker value={scope} onChange={onScope} />}
              placeholder="Ask anything or @ to add context"
              onSubmit={onSend}
              busy={busy}
              onStop={onStop}
              disabled={!connected}
            />
          </div>
        </div>
      </div>

      {/* Right agent panel (ref 02) */}
      {showPanel && shownDept && (
        <aside className="ds-enter hidden w-[320px] shrink-0 flex-col border-l border-hairline bg-ds-sidebar lg:flex">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-hairline px-4 text-[13.5px]">
            <span className="text-fg-muted">Agents</span>
            <span className="text-fg-faint">/</span>
            <AgentGlyph size={16} tone={toneOf(shownDept)} />
            <span className="truncate font-medium">{shownDept.agentName}</span>
            <IconButton label="Close panel" onClick={() => setPanel(false)} className="ml-auto">
              <X />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {activeDepts.length > 1 && (
              <div className="mb-4 flex flex-wrap gap-1">
                {activeDepts.map((d) => (
                  <button key={d.id} type="button" onClick={() => setFocusDept(d.id)} className={cx("ds-press flex h-6 items-center gap-1.5 rounded-full px-2 text-[12px]", d.id === shownDept.id ? "bg-surface-3 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg")}>
                    <AgentGlyph size={12} tone={toneOf(d)} />
                    {d.label}
                  </button>
                ))}
              </div>
            )}
            <AssistantHeader name={shownDept.agentName} tone={toneOf(shownDept)} />
            <div className="mt-3">
              <PanelTrace tools={deptSteps.get(shownDept.id) ?? []} />
            </div>
            <Link href={shownDept.href} className="mt-5 flex items-center gap-1 text-[12.5px] text-ds-accent hover:underline">
              Open {shownDept.label} <ChevronRight className="size-3.5" />
            </Link>
          </div>
        </aside>
      )}
    </div>
  );
}

function PanelTrace({ tools }: { tools: ToolPart[] }) {
  if (tools.length === 0) return <p className="text-[12.5px] text-fg-muted">No steps yet.</p>;
  const running = tools.some((t) => t.state === "input-available");
  const ms = tools.reduce((s, t) => s + (("durationMs" in t && t.durationMs) || 0), 0);
  return (
    <WorkedFor label={running ? "Working" : `Worked${ms > 0 ? ` for ${formatMs(ms)}` : ""}`} running={running} defaultOpen>
      <Trace nodes={traceNodes(tools)} limit={8} />
    </WorkedFor>
  );
}

function UserMessage({ message }: { message: FlueConversationMessage }) {
  const { scope, text } = stripScope(textOf(message));
  return <UserBubble to={scope ? `to ${scope.agentName}` : undefined}>{text}</UserBubble>;
}

function AssistantMessage({ message, approvals, decider, names }: { message: FlueConversationMessage; approvals: ApprovalRequest[]; decider: UseApprovalsResult; names: Record<string, string> }) {
  const blocks = blocksOf(message);
  return (
    <div className="ds-enter">
      <AssistantHeader name="Marketer" meta={message.timestamp ? formatRelative(message.timestamp) : undefined} />
      <div className="mt-2.5 space-y-3">
        {blocks.map((b, i) => {
          if (b.kind === "text") return <TextBlock key={i} text={b.text} />;
          if (b.kind === "reasoning")
            return (
              <WorkedFor key={i} label="Thought it through">
                <p className="whitespace-pre-wrap text-[12.5px] text-fg-muted">{b.text}</p>
              </WorkedFor>
            );
          const running = b.tools.some((t) => t.state === "input-available");
          const ms = b.tools.reduce((s, t) => s + (("durationMs" in t && t.durationMs) || 0), 0);
          return (
            <WorkedFor key={i} running={running} label={`${running ? "Working" : `Worked${ms > 0 ? ` for ${formatMs(ms)}` : ""}`} · ${b.tools.length} step${b.tools.length === 1 ? "" : "s"}`}>
              <Trace nodes={traceNodes(b.tools)} />
            </WorkedFor>
          );
        })}
        {approvals.map((a) => (
          <ApprovalBlock key={a.approvalId} approval={a} decider={decider} names={names} />
        ))}
      </div>
    </div>
  );
}

function TextBlock({ text }: { text: string }) {
  return (
    <>
      {splitOpenUISegments(text).map((s, i) =>
        s.kind === "markdown" ? (
          s.text.trim() ? <Markdown key={i} text={s.text} /> : null
        ) : (
          <GenerativeBlock key={i} source={s.source} complete={s.complete} />
        ),
      )}
    </>
  );
}

/** OpenUI list-shaped blocks render as a plan card (ref 02); the rest falls back to its lines. */
function GenerativeBlock({ source, complete }: { source: string; complete: boolean }) {
  const lines = source
    .split("\n")
    .map((l) => l.replace(/^[\s\-*\d.)]+/, "").replace(/["{}[\]]/g, "").trim())
    .filter((l) => l && !/^[A-Za-z]+\s*=\s*[A-Za-z]+\(/.test(l));
  return <PlanCard title="Plan" steps={lines.map((l, i) => ({ label: l, state: !complete && i === lines.length - 1 ? "active" : "todo" }))} />;
}

/** Every approval is a plan card (ref 02): what will happen, then Dismiss / Approve & Run. */
function ApprovalBlock({ approval, decider, names }: { approval: ApprovalRequest; decider: UseApprovalsResult; names?: Record<string, string> }) {
  const question = readHumanQuestion(approval);
  if (question) {
    const answered = decider.answers[approval.approvalId] ?? question.answer;
    const options = question.kind === "confirm" ? ["Yes", "No"] : (question.options ?? []);
    return (
      <QuestionCard
        title={question.question}
        options={options.map((label) => ({ label }))}
        allowOwn={question.kind !== "confirm"}
        placeholder={question.placeholder ?? "Type it your own"}
        answered={answered ?? undefined}
        busy={decider.isPending(approval.approvalId)}
        onAnswer={(value, i) => void decider.answer(approval, question.kind === "confirm" ? i === 0 : value)}
      />
    );
  }
  const d = departmentForTool(approval.tool, approval.args);
  const pending = approval.status === "PENDING_APPROVAL";
  const busy = decider.isPending(approval.approvalId);
  const err = decider.errors[approval.approvalId];
  const high = /high|critical/i.test(approval.riskTier);
  const steps = [
    ...(approval.reason ? [{ label: approval.reason }] : []),
    ...formatApprovalArgs(approval.args, { names }).map((row) => ({
      label: (
        <>
          <span className="text-fg-muted">{row.label}</span> <span className="text-fg">{row.value}</span>
        </>
      ),
    })),
  ];
  // The hook de-duplicates in-flight decisions; `busy` also locks both buttons so a second click can't queue the other answer.
  const decide = (d: "approve" | "reject") => {
    if (!busy) void decider.decide(approval, d);
  };
  const inFlight = decider.pending[approval.approvalId];
  return (
    <div className="space-y-1.5">
      <PlanCard
        title={describeTool(approval.tool, approval.args)}
        icon={<ShieldCheck className="size-4 text-on-fill" />}
        meta={<StatusBadge tone={high ? "attention" : "neutral"}>{d ? `${d.agentName} · ` : ""}{approval.riskTier.toLowerCase()} risk</StatusBadge>}
        steps={steps.length > 0 ? steps : [{ label: "Needs your go-ahead" }]}
        onDismiss={pending ? () => decide("reject") : undefined}
        onApprove={pending ? () => decide("approve") : undefined}
        approving={busy && inFlight !== "reject"}
        dismissing={busy && inFlight === "reject"}
        decided={pending ? undefined : approval.status === "APPROVED" ? "Approved" : approval.status === "REJECTED" ? "Dismissed" : "Expired"}
        approved={approval.status === "APPROVED"}
      />
      {err && <Notice error={err.message} />}
    </div>
  );
}

function TranscriptSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <Skeleton className="ml-auto h-9 w-2/3 rounded-ds-bubble" />
      <div className="space-y-2">
        <Skeleton className="h-3.5 w-1/3" />
        <Skeleton className="h-3.5 w-5/6" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
    </div>
  );
}

/** Shown when the agent harness isn't configured or reachable. Everything else keeps working. */
export function AgentOffline({ reason }: { reason: "not-configured" | "error" | "forbidden" }) {
  if (reason === "forbidden")
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Card className="ds-enter w-full max-w-[440px] p-5">
          <AgentGlyph size={22} />
          <h2 className="mt-3 text-[15px] font-medium">Your role doesn&apos;t include working with the agents</h2>
          <p className="mt-1.5 text-[13px] text-fg-muted">Ask an owner or admin if you need it. Billing and the rest of your workspace keep working.</p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            <ButtonLink href="/settings#billing" variant="primary">
              Open billing
            </ButtonLink>
          </div>
        </Card>
      </div>
    );
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="ds-enter w-full max-w-[440px] p-5">
        <AgentGlyph size={22} />
        <h2 className="mt-3 text-[15px] font-medium">{reason === "not-configured" ? "Marketer's agents aren't connected yet" : "Can't reach Marketer's agents"}</h2>
        <p className="mt-1.5 text-[13px] text-fg-muted">
          {reason === "not-configured"
            ? "Conversations run on the agent harness in agent/. Set NEXT_PUBLIC_AGENT_ORIGIN and SESSION_SIGNING_SECRET for the web app, then reload."
            : "The agent harness didn't answer. Everything else keeps working; try again in a moment."}
        </p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          <ButtonLink href="/activity" variant="primary">
            Open activity
          </ButtonLink>
          <ButtonLink href="/analytics" variant="secondary">
            See analytics
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}
