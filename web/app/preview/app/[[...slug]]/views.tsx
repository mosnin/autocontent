// Registry of preview views: key = the path after /preview/app/.
// Each group file renders pages' pure view components with fixture data.
import type { ReactNode } from "react";
import { SessionView } from "@/app/(app)/sessions/[id]/session-view";
import NewSessionPage from "@/app/(app)/sessions/new/page";
import { MemoryView } from "@/components/app/memory/memory-view";
import { ChatFixture } from "@/components/chat/chat-fixture";
import { FX_MEMORY_FACTS, FX_MEMORY_HISTORY, FX_MEMORY_LEARNINGS } from "@/lib/fixtures-memory";
import { VIEWS as business } from "./views-business";
import { VIEWS as insights } from "./views-insights";
import { VIEWS as work } from "./views-work";

export const PREVIEW_VIEWS: Record<string, () => Promise<ReactNode> | ReactNode> = {
  ...insights,
  ...work,
  ...business,
  // Memory: facts by entity type (one opened to show provenance and history), the review queue, learnings, empty.
  memory: () => <MemoryView facts={FX_MEMORY_FACTS} learnings={FX_MEMORY_LEARNINGS} preview={{ history: FX_MEMORY_HISTORY }} initialOpen="f-voice" />,
  "memory/review": () => <MemoryView facts={FX_MEMORY_FACTS} learnings={FX_MEMORY_LEARNINGS} preview={{ history: FX_MEMORY_HISTORY }} initialTab="review" />,
  "memory/learnings": () => <MemoryView facts={FX_MEMORY_FACTS} learnings={FX_MEMORY_LEARNINGS} preview={{ history: FX_MEMORY_HISTORY }} initialTab="learnings" />,
  "memory/empty": () => <MemoryView facts={[]} learnings={[]} preview={{ history: {} }} />,
  "sessions/new": () => NewSessionPage({ searchParams: Promise.resolve({}) }),
  "sessions/new/content": () => NewSessionPage({ searchParams: Promise.resolve({ dept: "content" }) }),
  // Without the agent harness configured, a session shows the offline card.
  "sessions/demo": () => <SessionView conversationId="demo" />,
  // A fixed transcript through the same ChatLayout a live session uses.
  "sessions/sample": () => <ChatFixture />,
};
