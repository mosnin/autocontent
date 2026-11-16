"use client";

import { Compass } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { draftNicheAction, type NicheDraft } from "@/lib/actions";
import { Crumbs, PageBody, PageHeader, PageIntro } from "../page";
import { Shader } from "../shader";
import { AgentAvatar, Button, Textarea } from "../ui";
import { Note } from "../content/bits";
import { departmentById } from "@/lib/departments";
import { newPlaybook } from "./format";
import { PlaybookEditor, type EditorCatalog } from "./playbook-editor";

const EXAMPLES = ["Fresh pasta lessons for busy home cooks", "Eerie 60-second horror stories with a whispered narrator", "70s film-grain history facts nobody teaches in school"];

/**
 * New playbook: describe it in a sentence, the Strategist drafts every
 * creative field (POST /api/v1/niches/draft), then review the whole
 * playbook in the editor and create it. Or skip straight to the editor.
 */
export function PlaybookNewView({ catalog, initialDraft }: { catalog: EditorCatalog; initialDraft?: NicheDraft }) {
  const strategist = departmentById("strategy")!;
  const [step, setStep] = useState<"describe" | "review">(initialDraft ? "review" : "describe");
  const [draft, setDraft] = useState<NicheDraft | undefined>(initialDraft);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    const description = text.trim();
    if (description.length < 8) {
      setError("Describe it in a sentence first.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await draftNicheAction(description);
    setBusy(false);
    if (!res.ok) {
      setError(res.error || "Couldn't draft it. Try again, or fill it in yourself.");
      return;
    }
    setDraft(res.draft);
    setStep("review");
  };

  return (
    <>
      <PageHeader icon={<Compass />} title={<Crumbs items={[<Link key="p" href="/playbooks" className="hover:text-foreground">Playbooks</Link>, "New"]} />} />
      <PageBody width="3xl">
        {step === "describe" ? (
          <div className="t-stagger space-y-6">
            <div className="relative h-28 overflow-hidden rounded-[20px]">
              <Shader palette={strategist.palette} className="absolute inset-0" seed={3} />
              <div className="absolute inset-x-5 bottom-4 flex items-center gap-2.5">
                <AgentAvatar name={strategist.agentName} palette={strategist.palette} size={30} />
                <span className="text-[14px] font-medium text-black/75">The Strategist drafts it with you</span>
              </div>
            </div>
            <PageIntro title="Describe your playbook in a sentence" className="mb-0">
              Who it's for and what it makes. The Strategist drafts the audience, look, voice and format; you review everything before it runs.
            </PageIntro>
            <div className="space-y-3">
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void generate();
                }}
                rows={3}
                disabled={busy}
                autoFocus
                aria-label="Describe your playbook"
                placeholder="e.g. Fresh pasta lessons for busy home cooks"
                className="min-h-24 resize-none text-[15px]"
              />
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLES.map((ex) => (
                  <button key={ex} type="button" disabled={busy} onClick={() => setText(ex)} className="press h-8 max-w-full truncate rounded-full border border-border bg-card px-3 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground">
                    {ex}
                  </button>
                ))}
              </div>
              <Note tone="danger">{error}</Note>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Button variant="primary" size="lg" onClick={() => void generate()} loading={busy}>
                  {busy ? "Drafting" : "Draft my playbook"}
                </Button>
                <Button variant="ghost" size="lg" disabled={busy} onClick={() => (setDraft(undefined), setStep("review"))}>
                  Fill it in myself
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="t-stagger">
            <PageIntro
              title={draft ? "Review your playbook" : "New playbook"}
              action={
                <Button variant="ghost" size="sm" onClick={() => setStep("describe")}>
                  Start over
                </Button>
              }
            >
              {draft ? "Drafted from your description. Change anything, pick where it posts, and create it." : "Fill in what matters; empty brief fields use sensible defaults."}
            </PageIntro>
            <PlaybookEditor mode="create" niche={newPlaybook(draft)} catalog={catalog} cancelHref="/playbooks" />
          </div>
        )}
      </PageBody>
    </>
  );
}
