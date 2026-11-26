"use client";

import { Column, PageHeader, Section, ToolTitle } from "@/design-system";
import { TOOL_ICON } from "@/components/shell/sidebar";
import type { Draft, Estimate, Options, ShortVideoBatch, StepId, Upload } from "@/lib/short-video";
import { isLive } from "@/lib/short-video";
import { LiveRefresh, toolGlyph } from "../shared";
import { BatchList } from "./batch-list";
import { CreateFlow } from "./create-flow";

/** Short video (Tool detail): the create flow, then recent batches with per-stage progress. */
export function ShortVideoView({
  batches,
  options,
  uploads,
  preview,
  flow,
}: {
  batches: ShortVideoBatch[] | null;
  options: Options | null;
  uploads: Upload[];
  preview?: boolean;
  flow?: { step?: StepId; draft?: Partial<Draft>; estimate?: Estimate; fineTune?: boolean };
}) {
  const live = (batches ?? []).some(isLive);
  return (
    <>
      <LiveRefresh active={live && !preview} ms={4000} />
      <PageHeader icon={toolGlyph("content")} crumbs={[{ label: "Content", href: "/content" }, { label: "Short video" }]} />
      <Column
        width="md"
        title={<ToolTitle icon={TOOL_ICON.content.icon} tone={TOOL_ICON.content.tone}>Short video</ToolTitle>}
        description="A topic or your script becomes finished vertical videos: voiceover, footage, subtitles and music."
      >
        <CreateFlow options={options} uploads={uploads} preview={preview} initialStep={flow?.step} initialDraft={flow?.draft} previewEstimate={flow?.estimate} openFineTune={flow?.fineTune} />
        <Section title="Recent">
          <BatchList batches={batches} preview={preview} />
        </Section>
      </Column>
    </>
  );
}
