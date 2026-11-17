import { MessageSquarePlus } from "lucide-react";
import { StartSession } from "@/components/chat/start-session";
import { TOOL_ICON } from "@/components/shell/sidebar";
import { AgentGlyph, Chip, PageHeader } from "@/design-system";
import { DEPARTMENTS, departmentById } from "@/lib/departments";

export const metadata = { title: "New session · Marketer" };

/** New session (ref 01 composer, ref 03 prompt pills): who you're asking, the composer, a few starting asks. */
export default async function NewSessionPage({ searchParams }: { searchParams: Promise<{ q?: string; dept?: string }> }) {
  const { q, dept } = await searchParams;
  const d = departmentById(dept);
  const asks = d ? d.asks : DEPARTMENTS.slice(1, 5).map((x) => x.asks[0]!);
  return (
    <>
      <PageHeader icon={<MessageSquarePlus />} title="New session" />
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-5 pb-16 pt-[14vh]">
        <div className="w-full max-w-[680px]">
          <div className="mb-6 flex flex-col items-center text-center">
            <AgentGlyph size={28} tone={d ? TOOL_ICON[d.id].tone : undefined} />
            <h2 className="mt-4 text-[22px] font-medium">{d ? `Ask the ${d.agentName}` : "What should we work on?"}</h2>
            <p className="mt-1.5 max-w-[52ch] text-[13.5px] text-fg-muted">{d ? d.summary : "Marketer plans the work, hands it to the right agent, and checks with you before anything spends or publishes."}</p>
          </div>
          <StartSession scope={d?.id ?? null} autoStart={q} autoFocus size="hero" />
          <div className="mt-4 flex flex-wrap justify-center gap-1.5">
            {asks.map((a) => (
              <Chip key={a} href={`/sessions/new?${d ? `dept=${d.id}&` : ""}q=${encodeURIComponent(a)}`}>
                {a}
              </Chip>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
