/**
 * @agent-starter/react — the UI layer for Agent Starter agents.
 *
 * Hooks over `@flue/react` / `@flue/sdk` and the `TelemetryEvent` contract,
 * plus drop-in components (full-page chat, support widget, copilot sidebar,
 * swarm timeline, control panel, human-oversight card) and OpenUI generative
 * UI. Import the stylesheet once: `import "@agent-starter/react/styles.css"`.
 */

// Shared types
export type {
  AgentSignal,
  AgentUsage,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalStatus,
  OpenUIPayload,
  PusherLikeChannel,
  PusherLikeClient,
  RunStatus,
  SuggestedPrompt,
  TelemetryConnectionStatus,
  TelemetryEvent,
  TelemetryMetrics,
  TelemetrySource,
  ThemeMode,
} from "./types.ts";

// Hooks
export { useAgentChat, attachmentsFromMessage } from "./hooks/use-agent-chat.ts";
export type { UseAgentChatOptions, UseAgentChatResult } from "./hooks/use-agent-chat.ts";
export { useAgentTelemetry, backoffDelay } from "./hooks/use-agent-telemetry.ts";
export type { ReconnectOptions, UseAgentTelemetryOptions, UseAgentTelemetryResult } from "./hooks/use-agent-telemetry.ts";
export { useApprovals, approvalDecisionUrl, ApprovalDecisionError } from "./hooks/use-approvals.ts";
export type { ApprovalDecisionResult, UseApprovalsOptions, UseApprovalsResult } from "./hooks/use-approvals.ts";

// Components
export { AgentChat } from "./components/AgentChat.tsx";
export type { AgentChatProps } from "./components/AgentChat.tsx";
export { ChatWidget } from "./components/ChatWidget.tsx";
export type { ChatWidgetProps, EscalationSignal } from "./components/ChatWidget.tsx";
export { mountChatWidget } from "./mount.tsx";
export type { MountChatWidgetOptions, MountedChatWidget } from "./mount.tsx";
export { AgentSidebar } from "./components/AgentSidebar.tsx";
export type { AgentSidebarProps, QuickAction, SidebarContext } from "./components/AgentSidebar.tsx";
export { SwarmTimeline } from "./components/SwarmTimeline.tsx";
export type { SwarmTimelineProps } from "./components/SwarmTimeline.tsx";
export { AgentControlPanel, budgetPercent } from "./components/AgentControlPanel.tsx";
export type { AgentControlPanelProps } from "./components/AgentControlPanel.tsx";
export { HumanOversightCard, riskTone } from "./components/HumanOversightCard.tsx";
export type { HumanOversightCardProps } from "./components/HumanOversightCard.tsx";
export { GenerativeUI } from "./components/GenerativeUI.tsx";
export type { GenerativeUIProps } from "./components/GenerativeUI.tsx";
export type { AttachmentOptions, ChatConnectionProps, ChatPresentationProps } from "./components/chat/types.ts";

// Generative UI library
export { defaultComponents, defaultLibrary, defaultLibraryExample, generativeUISystemPrompt } from "./generative/library.tsx";
export type { GenerativeUIPromptOptions } from "./generative/library.tsx";

// Pure helpers (usable without React: workers, tests, custom UIs)
export {
  approvalRequestSchema,
  deriveApprovals,
  deriveTelemetry,
  deriveUsage,
  isDataPart,
  isDataPartNamed,
  parseApprovals,
  parseOpenUIPayload,
  readMessageUsage,
  splitOpenUISegments,
} from "./internal/parts.ts";
export type { DataPart, TextSegment } from "./internal/parts.ts";
export { computeTelemetryMetrics, deriveRunStatus, latestRunStatus, parseTelemetryPayload, pusherTelemetryChannel, telemetryEventSchema } from "./internal/telemetry.ts";
export type { DeriveRunStatusOptions, ParsedTelemetry } from "./internal/telemetry.ts";
export { readMessageContext, withContext } from "./internal/context.ts";
export { SWARM_PALETTE, senderColor } from "./internal/palette.ts";

// Thread history + ask_person questions (worker A)
export { readHumanQuestion } from "./hooks/use-approvals.ts";
export type { HumanQuestion } from "./hooks/use-approvals.ts";
export { useThreads } from "./hooks/use-threads.ts";
export type { ThreadSummary, UseThreadsOptions, UseThreadsResult } from "./hooks/use-threads.ts";
export { ThreadList, relativeTime } from "./components/ThreadList.tsx";
export type { ThreadListProps } from "./components/ThreadList.tsx";

// Diff review (coding agent, approval previews)
export { DiffView, diffFromArgs, parseUnifiedDiff } from "./components/DiffView.tsx";
export type { DiffFile, DiffLine, DiffLineType, DiffViewProps } from "./components/DiffView.tsx";

// Multi-agent runs: Gantt of parallel runs with delegation edges, per-agent transcript drill-down
export { RunGantt, deriveGantt, layoutGantt, tickStepMs } from "./components/RunGantt.tsx";
export type { GanttEdge, GanttLayout, GanttLayoutBar, GanttRun, RunGanttProps } from "./components/RunGantt.tsx";
export { AgentTranscript, buildTranscript, toolTone } from "./components/AgentTranscript.tsx";
export type { AgentTranscriptProps, ToolTone, TranscriptRenderClass, TranscriptRow } from "./components/AgentTranscript.tsx";
export { PUSHER_TELEMETRY_EVENT, unwrapTelemetryFrame } from "./hooks/use-agent-telemetry.ts";

// Persistent (always-on) agents: status, kill switch, proposals, turns and the audit log of one agent
export { PersistentAgentPanel, formatNextTick, showValue, turnTone } from "./components/PersistentAgentPanel.tsx";
export type { PersistentAgentPanelProps } from "./components/PersistentAgentPanel.tsx";
export { parseAuditEntry, parsePersistentState, parseProposal, parseTurnSummary, usePersistentAgent } from "./hooks/use-persistent-agent.ts";
export type {
  PersistentAgentState,
  PersistentAuditEntry,
  PersistentConfigView,
  PersistentProposal,
  PersistentReview,
  PersistentStatus,
  PersistentTurnOutcome,
  PersistentTurnSummary,
  ProposalDiff,
  ProposalStatus,
  ReviewDecision,
  UsePersistentAgentOptions,
  UsePersistentAgentResult,
} from "./hooks/use-persistent-agent.ts";
