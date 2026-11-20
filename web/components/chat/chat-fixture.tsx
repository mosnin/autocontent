"use client";

import type { FlueConversationMessage } from "@flue/sdk";
import { useState } from "react";
import type { ToolPart } from "@/lib/agent/parts";
import { departmentForTool } from "@/lib/agent/tool-labels";
import type { ApprovalRequest } from "@/lib/agent/types";
import type { UseApprovalsResult } from "@/lib/agent/use-approvals";
import type { DepartmentId } from "@/lib/departments";
import { ChatLayout } from "./conversation";

/* A fixed transcript for /preview/app/sessions/sample: renders ChatLayout exactly as a live session would. */

const tool = (id: string, toolName: string, input: unknown, durationMs = 4000, state: ToolPart["state"] = "output-available"): ToolPart =>
  ({ type: "dynamic-tool", toolCallId: id, toolName, input, output: {}, state, durationMs }) as unknown as ToolPart;

const TOOLS_1 = [
  tool("t1", "get_workspace_overview", { days: 30 }, 2100),
  tool("t2", "list_top_content", { days: 30 }, 1800),
  tool("t3", "delegate_task", { agent: "content", task: "Draft three hooks around the fresh pasta guide" }, 52000),
  tool("t4", "delegate_task", { agent: "paid", task: "Check CPA on the spring ad set" }, 31000),
];
const TOOLS_2 = [tool("t5", "generate_video", { niche: "Pasta at home", count: 3 }, 0, "input-available"), tool("t6", "get_ad_campaign_metrics", { id: "spring" }, 6000)];

const msg = (id: string, role: "user" | "assistant", parts: unknown[], metadata?: Record<string, unknown>): FlueConversationMessage =>
  ({ id, role, parts, metadata, timestamp: new Date(Date.now() - 4 * 60_000).toISOString() }) as unknown as FlueConversationMessage;
const text = (t: string) => ({ type: "text", text: t, state: "done" });

const MESSAGES: FlueConversationMessage[] = [
  msg("u1", "user", [text("What's working this month, and what should we push next week?")]),
  // traceSpanId: the run's root span id, so the reply gets thumbs (docs/observability/braintrust.md).
  msg("a1", "assistant", [
    ...TOOLS_1,
    text(
      "Views are up **28%** on the month, almost all from short video. *3 pasta mistakes every home cook makes* did 48.2K on TikTok, twice anything else.\n\nPaid is the weak spot: the spring ad set's cost per conversion rose 48% over three days.\n\nHere's what I'd do next week:\n\n1. Make three more mistake-style hooks from the fresh pasta guide\n2. Pause the spring ad set and move its budget to the best video as a Spark ad\n3. Post the article as a five-part carousel on Instagram",
    ),
  ], { traceSpanId: "4f2a9c1e7b3d5a60" }),
  msg("u2", "user", [text("Do it. Start with the ad change.")]),
  msg("a2", "assistant", [...TOOLS_2, text("I need your go-ahead before I touch spend.")]),
];

const APPROVALS: Record<string, ApprovalRequest[]> = {
  a2: [
    {
      approvalId: "ap1",
      tool: "change_ad_budget",
      riskTier: "high",
      reason: "Moves $40/day from the spring ad set to a Spark ad on the top video.",
      args: { campaign: "Spring launch", from_daily_usd: 40, to: "Spark ad · 3 pasta mistakes", daily_usd: 40 },
      status: "PENDING_APPROVAL",
      messageId: "a2",
    } as ApprovalRequest,
    {
      approvalId: "ap2",
      tool: "ask_person",
      riskTier: "low",
      reason: "",
      args: { type: "human-question", kind: "choice", questionId: "q1", question: "Which angle should the three new hooks take?", options: ["Mistakes to avoid", "Speed: dinner in 20 minutes", "Fresh vs dried, settled"] },
      status: "PENDING_APPROVAL",
      messageId: "a2",
    } as ApprovalRequest,
  ],
};

const noopDecider = {
  decide: async () => ({}) as never,
  pending: {},
  isPending: () => false,
  statuses: {},
  errors: {},
  resolve: <T,>(a: T) => a,
  answers: {},
  answer: async () => ({}) as never,
} as unknown as UseApprovalsResult;

export function ChatFixture() {
  const [scope, setScope] = useState<DepartmentId | null>(null);
  const deptSteps = new Map<DepartmentId, ToolPart[]>();
  for (const t of [...TOOLS_1, ...TOOLS_2]) {
    const d = departmentForTool(t.toolName, t.input);
    if (d) deptSteps.set(d.id, [...(deptSteps.get(d.id) ?? []), t]);
  }
  return (
    <ChatLayout
      title="What's working this month"
      connected
      messages={MESSAGES}
      approvalsFor={(id) => APPROVALS[id] ?? []}
      decider={noopDecider}
      busy
      deptSteps={deptSteps}
      scope={scope}
      onScope={setScope}
      onSend={() => undefined}
      onFeedback={() => new Promise((resolve) => setTimeout(resolve, 400))}
    />
  );
}
