// Preview views for Short video (/preview/app/content/short…). key = path after /preview/app/.
import type { ReactNode } from "react";
import { ShortVideoView } from "@/components/app/content/short-video/short-video-view";
import { FX_SV_BATCHES, FX_SV_ESTIMATE, FX_SV_OPTIONS, FX_SV_UPLOADS } from "@/lib/fixtures-short-video";

const topic = { source: "topic" as const, topic: "Three coffee myths baristas wish you'd stop believing" };

export const VIEWS: Record<string, () => ReactNode> = {
  // The first step with recent batches below: running, waiting for approval, partly ready.
  "content/short": () => <ShortVideoView preview batches={FX_SV_BATCHES} options={FX_SV_OPTIONS} uploads={FX_SV_UPLOADS} />,
  "content/short/empty": () => <ShortVideoView preview batches={[]} options={FX_SV_OPTIONS} uploads={[]} />,
  "content/short/look": () => <ShortVideoView preview batches={[]} options={FX_SV_OPTIONS} uploads={FX_SV_UPLOADS} flow={{ step: "look", draft: topic, estimate: FX_SV_ESTIMATE }} />,
  "content/short/footage": () => (
    <ShortVideoView preview batches={[]} options={FX_SV_OPTIONS} uploads={FX_SV_UPLOADS} flow={{ step: "footage", draft: { ...topic, settings: { ...FX_SV_OPTIONS.defaults, footage: { ...FX_SV_OPTIONS.defaults.footage, sources: ["pexels", "pixabay", "uploads"], upload_ids: ["up-1"] } } }, estimate: FX_SV_ESTIMATE }} />
  ),
  "content/short/render": () => <ShortVideoView preview batches={[]} options={FX_SV_OPTIONS} uploads={FX_SV_UPLOADS} flow={{ step: "render", draft: { ...topic, variants: 3 }, estimate: FX_SV_ESTIMATE }} />,
  "content/short/fine-tune": () => <ShortVideoView preview batches={FX_SV_BATCHES} options={FX_SV_OPTIONS} uploads={FX_SV_UPLOADS} flow={{ step: "render", draft: topic, estimate: FX_SV_ESTIMATE, fineTune: true }} />,
};
