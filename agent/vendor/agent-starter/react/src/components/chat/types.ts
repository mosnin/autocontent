import type { FlueClient, FlueConversationMessage } from "@flue/react";
import type { ConversationLiveMode } from "@flue/sdk";
import type { ActionEvent, Library } from "@openuidev/react-lang";
import type { ReactNode } from "react";
import type { UseAgentChatResult } from "../../hooks/use-agent-chat.ts";
import type { UseApprovalsOptions } from "../../hooks/use-approvals.ts";
import type { DataPart } from "../../internal/parts.ts";
import type { ApprovalDecision, ApprovalRequest, SuggestedPrompt } from "../../types.ts";

/** How a chat component connects to its agent: a URL/client, or an existing `useAgentChat()` result. */
export interface ChatConnectionProps {
  /** Conversation URL (`/api/agents/support/${conversationId}`). */
  url?: string;
  /** Pre-configured Flue client (memoized). */
  client?: FlueClient;
  /** Bearer token for the client built from `url`. */
  token?: string;
  /** Live transport. Default `sse`. */
  live?: ConversationLiveMode;
  /** Share an existing `useAgentChat()` result instead of connecting here. */
  chat?: UseAgentChatResult;
}

export interface AttachmentOptions {
  /** `accept` attribute. Default `image/*,application/pdf` (what Flue delivers to models). */
  accept?: string;
  /** Files per message. Default 4. */
  maxFiles?: number;
  /** Raw bytes per file. Default 10 MiB (Flue caps base64 at 14 MiB). */
  maxFileBytes?: number;
}

/** Presentation options shared by `<AgentChat />`, `<ChatWidget />` and `<AgentSidebar />`. */
export interface ChatPresentationProps {
  /** Composer placeholder. */
  placeholder?: string;
  /** Prompts offered in an empty conversation. */
  suggestedPrompts?: SuggestedPrompt[];
  /** Replaces the default empty state. */
  emptyState?: ReactNode;
  /** Enable image/PDF attachments. */
  attachments?: boolean | AttachmentOptions;
  /** OpenUI component library for generative UI blocks. Default `defaultLibrary`. */
  library?: Library;
  /**
   * Generative UI actions. Default: `continue_conversation` sends the
   * button's message (with its context), `open_url` opens http(s) links in a
   * new tab.
   */
  onAction?: (event: ActionEvent, chat: UseAgentChatResult) => void;
  /** Where approval decisions are POSTed (see `useApprovals`). */
  approvals?: UseApprovalsOptions;
  /** Custom approval handler; replaces the built-in POST. */
  onApprovalDecision?: (approval: ApprovalRequest, decision: ApprovalDecision, note?: string) => unknown;
  /** Show reasoning parts (collapsed). Default `true`. */
  showReasoning?: boolean;
  /** Show tool-call cards. Default `true`. */
  showToolCalls?: boolean;
  /** Also show messages Flue marks `diagnostic`. Default `false`. */
  showDiagnostics?: boolean;
  /** Render custom `data-*` parts (approval, openui and telemetry parts are handled built-in). */
  renderDataPart?: (part: DataPart, message: FlueConversationMessage) => ReactNode;
  /** Assistant display name. Default "Assistant". */
  assistantName?: string;
  /** Assistant avatar image URL. */
  assistantAvatarUrl?: string;
  /** Called with the user's text whenever a message is sent. */
  onSend?: (text: string) => void;
}
