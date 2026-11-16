// Preview views for the work pages (Content, SEO, Playbooks). key = path after /preview/app/.
import type { ReactNode } from "react";
import { ContentView } from "@/components/mk/content/content-view";
import { VideoDetailView } from "@/components/mk/content/video-detail-view";
import { estimateVideoCostUsd } from "@/lib/cost-estimator";
import {
  FX_FAILURES,
  FX_IMAGE_POSTS,
  FX_JOB_DETAIL,
  FX_JOB_METRICS,
  FX_JOBS,
  FX_METRICS_SUMMARY,
  FX_NICHES,
  FX_SPEND,
  FX_TEMPLATES,
} from "@/lib/fixtures-work";

const content = (tab: "videos" | "carousels" | "templates") => (
  <ContentView
    preview
    tab={tab}
    data={{ jobs: FX_JOBS, niches: FX_NICHES, imagePosts: FX_IMAGE_POSTS, templates: FX_TEMPLATES, spend: FX_SPEND, failures: FX_FAILURES, metrics: FX_METRICS_SUMMARY, channelsConnected: false, globalCap: "15.00" }}
  />
);

export const VIEWS: Record<string, () => Promise<ReactNode> | ReactNode> = {
  content: () => content("videos"),
  "content/carousels": () => content("carousels"),
  "content/templates": () => content("templates"),
  "content/empty": () => <ContentView preview data={{ jobs: [], niches: [], imagePosts: [], templates: [], spend: null, failures: null, metrics: null, channelsConnected: true, globalCap: null }} />,
  "content/videos/v1": () => <VideoDetailView preview job={FX_JOB_DETAIL} niche={FX_NICHES[0]} metrics={FX_JOB_METRICS} costUsd="0.7400" estimate={estimateVideoCostUsd(FX_NICHES[0])} />,
  "content/videos/v4": () => <VideoDetailView preview job={FX_JOBS[1]} niche={FX_NICHES[0]} metrics={null} costUsd={null} estimate={estimateVideoCostUsd(FX_NICHES[0])} />,
  "content/videos/v9": () => <VideoDetailView preview job={FX_JOBS[2]} niche={FX_NICHES[1]} metrics={null} costUsd="0.4100" estimate={estimateVideoCostUsd(FX_NICHES[1])} />,
};
