// Preview views for the work pages (Content, SEO, Playbooks). key = path after /preview/app/.
import type { ReactNode } from "react";
import { ContentView } from "@/components/app/content/content-view";
import { VideoDetailView } from "@/components/app/content/video-detail-view";
import { PlaybookDetailView } from "@/components/app/playbooks/playbook-detail-view";
import { PlaybookEditView } from "@/components/app/playbooks/playbook-edit-view";
import { PlaybookNewView } from "@/components/app/playbooks/playbook-new-view";
import { PlaybooksView } from "@/components/app/playbooks/playbooks-view";
import { ArticleDetailView } from "@/components/app/seo/article-detail-view";
import { SeoView } from "@/components/app/seo/seo-view";
import { estimateVideoCostUsd } from "@/lib/cost-estimator";
import { FX_BATCHES, FX_SEO_ARTICLE, FX_SEO_LIVE, FX_SEO_NO_COVER, FX_SEO_SCHEDULED, FX_SEO_UNKNOWN, FX_UNSPLASH, FX_WORDPRESS, FX_WORDPRESS_OFF } from "@/lib/fixtures-seo";
import {
  FX_ARTICLES,
  FX_AUDIO,
  FX_KITS,
  FX_PERFORMANCE,
  FX_PRESETS,
  FX_SCRIPT_MODELS,
  FX_SPEND_HISTORY,
  FX_VIDEO_MODELS,
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

const catalog = { videoModels: FX_VIDEO_MODELS, scriptModels: FX_SCRIPT_MODELS, audio: FX_AUDIO, kits: FX_KITS, presets: FX_PRESETS };

export const VIEWS: Record<string, () => Promise<ReactNode> | ReactNode> = {
  content: () => content("videos"),
  "content/carousels": () => content("carousels"),
  "content/templates": () => content("templates"),
  "content/empty": () => <ContentView preview data={{ jobs: [], niches: [], imagePosts: [], templates: [], spend: null, failures: null, metrics: null, channelsConnected: true, globalCap: null }} />,
  "content/videos/v1": () => <VideoDetailView preview job={FX_JOB_DETAIL} niche={FX_NICHES[0]} metrics={FX_JOB_METRICS} costUsd="0.7400" estimate={estimateVideoCostUsd(FX_NICHES[0])} />,
  "content/videos/v4": () => <VideoDetailView preview job={FX_JOBS[1]} niche={FX_NICHES[0]} metrics={null} costUsd={null} estimate={estimateVideoCostUsd(FX_NICHES[0])} />,
  "content/videos/v9": () => <VideoDetailView preview job={FX_JOBS[2]} niche={FX_NICHES[1]} metrics={null} costUsd="0.4100" estimate={estimateVideoCostUsd(FX_NICHES[1])} />,
  seo: () => <SeoView preview articles={FX_ARTICLES} niches={FX_NICHES} />,
  "seo/empty": () => <SeoView preview articles={[]} niches={FX_NICHES} />,
  // SEO articles: bulk batches (one paused at the spend cap), and an article's cover, publishing, metadata and sources.
  "seo/bulk": () => <SeoView preview articles={FX_ARTICLES} niches={FX_NICHES} batches={FX_BATCHES} />,
  "seo/a1/publish": () => <ArticleDetailView preview article={FX_SEO_ARTICLE} niche={FX_NICHES[0]} wordpress={FX_WORDPRESS} coverFixture={FX_UNSPLASH} />,
  "seo/a1/connect": () => <ArticleDetailView preview article={FX_SEO_NO_COVER} niche={FX_NICHES[0]} wordpress={FX_WORDPRESS_OFF} coverFixture={FX_UNSPLASH} />,
  "seo/a1/scheduled": () => <ArticleDetailView preview article={FX_SEO_SCHEDULED} niche={FX_NICHES[0]} wordpress={FX_WORDPRESS} coverFixture={FX_UNSPLASH} />,
  "seo/a1/live": () => <ArticleDetailView preview article={FX_SEO_LIVE} niche={FX_NICHES[0]} wordpress={FX_WORDPRESS} coverFixture={FX_UNSPLASH} />,
  "seo/a1/unknown": () => <ArticleDetailView preview article={FX_SEO_UNKNOWN} niche={FX_NICHES[0]} wordpress={FX_WORDPRESS} coverFixture={FX_UNSPLASH} />,
  "seo/a1": () => <ArticleDetailView preview article={FX_ARTICLES[0]} niche={FX_NICHES[0]} />,
  "seo/a2": () => <ArticleDetailView preview article={FX_ARTICLES[1]} niche={FX_NICHES[1]} />,
  "seo/a3": () => <ArticleDetailView preview article={FX_ARTICLES[2]} niche={FX_NICHES[0]} />,
  playbooks: () => <PlaybooksView niches={FX_NICHES} performance={FX_PERFORMANCE} spend={FX_SPEND} />,
  "playbooks/empty": () => <PlaybooksView niches={[]} performance={{}} spend={null} />,
  "playbooks/new": () => <PlaybookNewView catalog={catalog} />,
  "playbooks/new/review": () => (
    <PlaybookNewView
      catalog={catalog}
      initialDraft={{ title: "Pasta at home", description: "Short, warm lessons that make fresh pasta feel doable on a weeknight.", target_audience: "Home cooks, 25–45", hashtags: ["pasta", "homecooking"], visual_style: "Warm claymation kitchen", voice: "sage", target_duration_sec: 45, scene_count: 6, image_quality: "medium", video_resolution: "720p", scene_max_duration_sec: 5, tts_style_directions: "warm", character_description: "Nonna Rosa" }}
    />
  ),
  "playbooks/n1": () => <PlaybookDetailView preview niche={FX_NICHES[0]} performance={FX_PERFORMANCE.n1} spendHistory={FX_SPEND_HISTORY} spend={FX_SPEND} jobs={FX_JOBS.filter((j) => j.niche_id === "n1")} />,
  "playbooks/n1/edit": () => <PlaybookEditView niche={FX_NICHES[0]} catalog={catalog} />,
};
