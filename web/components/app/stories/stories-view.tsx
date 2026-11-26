"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Column, EmptyLine, Field, Input, List, ListRow, Notice, NotAllowed, PageHeader, Section, Segmented, StatusBadge, Textarea, Time, useAllowed, usePending } from "@/design-system";
import { LiveRefresh, toolGlyph } from "@/components/app/content/shared";
import { formatUsd } from "@/lib/format";
import { storyApi } from "./story-api";
import { STORY_BUSY, STORY_STATUS_LABEL, storyTone, type StoryAspect, type StorySummary } from "./types";

const PLACEHOLDER = {
  idea: "A night-shift barista notices the same stranger orders a coffee for someone who never arrives.",
  script: "INT. CAFE - DAWN\nMia wipes the counter. The door chimes. A stranger orders two flat whites…",
};

/** Story videos (Column md): one composer that starts a story, then the recent ones. */
export function StoriesView({ stories, preview }: { stories: StorySummary[] | null; preview?: boolean }) {
  const router = useRouter();
  const canMake = useAllowed("content:create");
  const [mode, setMode] = useState<"idea" | "script">("idea");
  const [source, setSource] = useState("");
  const [requirement, setRequirement] = useState("");
  const [style, setStyle] = useState("");
  const [aspect, setAspect] = useState<StoryAspect>("9:16");
  const { busy, error, run } = usePending<"create">();
  const working = (stories ?? []).some((s) => STORY_BUSY.has(s.status));
  const ready = source.trim().length >= 3;

  const submit = () =>
    run("create", async () => {
      if (preview) return;
      const story = await storyApi.create({ mode, source, requirement, style, aspect });
      router.push(`/content/stories/${story.id}`);
    });

  return (
    <>
      <LiveRefresh active={working && !preview} />
      <PageHeader icon={toolGlyph("content")} crumbs={[{ label: "Content", href: "/content" }, { label: "Story videos" }]} />
      <Column width="md" title="Story video" description="An idea or a script becomes a short film. You review the script, then the storyboard, before anything renders.">
        <div className="space-y-8">
          <Card className="ds-enter space-y-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented
                label="Start from"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "idea", label: "An idea" },
                  { value: "script", label: "A script" },
                ]}
              />
              <Segmented
                label="Shape"
                size="sm"
                value={aspect}
                onChange={setAspect}
                options={[
                  { value: "9:16", label: "9:16" },
                  { value: "16:9", label: "16:9" },
                  { value: "1:1", label: "1:1" },
                ]}
              />
            </div>
            <Field label={mode === "idea" ? "The idea" : "The script"}>
              <Textarea rows={mode === "idea" ? 3 : 8} value={source} onChange={(e) => setSource(e.target.value)} maxLength={20000} placeholder={PLACEHOLDER[mode]} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Audience and tone" hint="Optional">
                <Input value={requirement} onChange={(e) => setRequirement(e.target.value)} maxLength={1000} placeholder="Coffee lovers, warm and a little funny" />
              </Field>
              <Field label="Look" hint="Optional">
                <Input value={style} onChange={(e) => setStyle(e.target.value)} maxLength={500} placeholder="35mm film, soft morning light" />
              </Field>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <p className="text-[12px] text-fg-muted">Writing the script costs a few cents. You&apos;ll see the render estimate before you render.</p>
              <Button variant="primary" onClick={submit} loading={busy === "create"} disabled={!ready || !canMake}>
                Write the script
              </Button>
            </div>
            {!canMake && <NotAllowed>Owners, admins and marketers can make story videos.</NotAllowed>}
            <Notice error={error} />
          </Card>

          <Section title="Recent">
            {stories === null ? (
              <EmptyLine>Couldn&apos;t load story videos. Refresh to try again.</EmptyLine>
            ) : stories.length === 0 ? (
              <EmptyLine>Your story videos will show up here.</EmptyLine>
            ) : (
              <List>
                {stories.map((s) => (
                  <ListRow key={s.id} href={`/content/stories/${s.id}`}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-fg">{s.title || "Untitled story"}</p>
                      <p className="text-[12px] text-fg-muted tabular">
                        {s.shots ? `${s.shots} shots · ` : ""}
                        {formatUsd(s.spent_usd)} spent · <Time iso={s.created_at} />
                      </p>
                    </div>
                    <StatusBadge tone={storyTone(s.status)}>{STORY_STATUS_LABEL[s.status]}</StatusBadge>
                  </ListRow>
                ))}
              </List>
            )}
          </Section>
        </div>
      </Column>
    </>
  );
}
