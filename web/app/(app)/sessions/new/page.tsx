import { MessageSquarePlus } from "lucide-react";
import { StartSession } from "@/components/mk/agent/start-session";
import { PageHeader } from "@/components/mk/page";
import { AgentAvatar } from "@/components/mk/ui";
import { DEPARTMENTS, departmentById, MARKETER } from "@/lib/departments";

export const metadata = { title: "New session · Marketer" };

export default async function NewSessionPage({ searchParams }: { searchParams: Promise<{ q?: string; dept?: string }> }) {
  const { q, dept } = await searchParams;
  const d = departmentById(dept);
  return (
    <>
      <PageHeader icon={<MessageSquarePlus />} title="New session" />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-5 py-10">
        <div className="t-stagger w-full max-w-[680px]">
          <div className="mb-6 flex flex-col items-center text-center">
            <AgentAvatar name={d?.agentName ?? MARKETER.name} palette={d?.palette ?? MARKETER.palette} size={44} />
            <h2 className="mt-4 text-[26px] font-medium tracking-[-0.022em]">{d ? `Ask the ${d.agentName}` : "What should we work on?"}</h2>
            <p className="mt-2 max-w-[52ch] text-[15px] text-muted-foreground">
              {d ? d.summary : "Marketer plans the work, hands it to the right department, and checks with you before anything spends or publishes."}
            </p>
          </div>
          <StartSession scope={d?.id ?? null} autoStart={q} autoFocus suggestions={d ? d.asks : DEPARTMENTS.slice(1, 5).map((x) => x.asks[0]!)} />
        </div>
      </div>
    </>
  );
}
