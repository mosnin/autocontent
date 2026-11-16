"use client";

import { MessageSquare, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAgent } from "@/components/mk/agent/agent-provider";
import { Conversation } from "@/components/mk/agent/conversation";
import { Crumbs, PageHeader } from "@/components/mk/page";
import { Button } from "@/components/mk/ui";

export function SessionView({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const { threads } = useAgent();
  const title = threads?.threads.find((t) => t.conversationId === conversationId)?.title || "Session";
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <PageHeader icon={<MessageSquare />} title={<Crumbs items={[<Link key="s" href="/home" className="hover:text-foreground">Chat</Link>, title]} />}>
        {threads && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 lg:mr-9"
            aria-label="Delete session"
            title="Delete session"
            onClick={() => void threads.remove(conversationId).then(() => router.push("/home"))}
          >
            <Trash2 />
          </Button>
        )}
      </PageHeader>
      <Conversation conversationId={conversationId} />
    </div>
  );
}
