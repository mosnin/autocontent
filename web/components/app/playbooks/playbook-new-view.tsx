"use client";

import { useState } from "react";
import { Button, Chip, Column, Notice, PageHeader, Textarea } from "@/design-system";
import { draftNicheAction, type NicheDraft } from "@/lib/actions";
import { toolGlyph } from "../content/shared";
import { newPlaybook } from "./format";
import { PlaybookEditor, type EditorCatalog } from "./playbook-editor";

const EXAMPLES = ["Fresh pasta lessons for busy home cooks", "Eerie 60-second horror stories with a whispered narrator", "70s film-grain history facts nobody teaches in school"];

/**
 * New playbook (Column md): describe it in a sentence and the Strategist
 * drafts every creative field (POST /api/v1/niches/draft), then review the
 * whole playbook in the editor and create it. Or skip straight to the editor.
 */
export function PlaybookNewView({ catalog, initialDraft }: { catalog: EditorCatalog; initialDraft?: NicheDraft }) {
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
      <PageHeader icon={toolGlyph("strategy")} crumbs={[{ label: "Playbooks", href: "/playbooks" }, { label: "New" }]} />
      {step === "describe" ? (
        <Column width="md" title="New playbook" description="Describe it in a sentence. The Strategist drafts the rest for you to review.">
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
                placeholder="Who it's for and what it makes"
                className="min-h-24 resize-none"
              />
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <Chip key={ex} onClick={() => !busy && setText(ex)} className="max-w-full">
                  <span className="truncate">{ex}</span>
                </Chip>
              ))}
            </div>
            <Notice error={error} />
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button variant="primary" size="lg" onClick={() => void generate()} loading={busy}>
                {busy ? "Drafting" : "Draft my playbook"}
              </Button>
              <Button variant="ghost" size="lg" disabled={busy} onClick={() => (setDraft(undefined), setStep("review"))}>
                Fill it in myself
              </Button>
            </div>
          </div>
        </Column>
      ) : (
        <Column
          width="md"
          title={draft ? "Review your playbook" : "New playbook"}
          description={draft ? "Drafted from your description. Change anything, pick where it posts, then create it." : "Empty brief fields use sensible defaults."}
          actions={
            <Button variant="ghost" onClick={() => setStep("describe")}>
              Start over
            </Button>
          }
        >
          <PlaybookEditor mode="create" niche={newPlaybook(draft)} catalog={catalog} cancelHref="/playbooks" />
        </Column>
      )}
    </>
  );
}
