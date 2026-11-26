"use client";

import { useRouter } from "next/navigation";
import { useAgent } from "@/components/chat/agent-provider";
import { Conversation } from "@/components/chat/conversation";

export function SessionView({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const { threads } = useAgent();
  const title = threads?.threads.find((t) => t.conversationId === conversationId)?.title || "New session";
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Conversation conversationId={conversationId} title={title} onDelete={threads ? () => void threads.remove(conversationId).then(() => router.push("/home")) : undefined} />
    </div>
  );
}
