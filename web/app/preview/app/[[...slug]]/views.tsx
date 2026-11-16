// Registry of preview views: key = the path after /preview/app/.
// Each group file renders pages' pure view components with fixture data.
import type { ReactNode } from "react";
import { SessionView } from "@/app/(app)/sessions/[id]/session-view";
import NewSessionPage from "@/app/(app)/sessions/new/page";
import { VIEWS as business } from "./views-business";
import { VIEWS as insights } from "./views-insights";
import { VIEWS as work } from "./views-work";

export const PREVIEW_VIEWS: Record<string, () => Promise<ReactNode> | ReactNode> = {
  ...insights,
  ...work,
  ...business,
  "sessions/new": () => NewSessionPage({ searchParams: Promise.resolve({}) }),
  "sessions/new/content": () => NewSessionPage({ searchParams: Promise.resolve({ dept: "content" }) }),
  // Without the agent harness configured, a session shows the offline card.
  "sessions/demo": () => <SessionView conversationId="demo" />,
};
