import { ShortVideoView } from "@/components/app/content/short-video/short-video-view";
import type { Options, ShortVideoBatch, Upload } from "@/lib/short-video";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Short video · Marketer" };

export default async function ShortVideoPage() {
  const [batches, options, uploads] = await Promise.all([
    safe<ShortVideoBatch[]>("/api/v1/short-videos?limit=20"),
    safe<Options>("/api/v1/short-videos/options"),
    safe<Upload[]>("/api/v1/short-videos/uploads"),
  ]);
  return <ShortVideoView batches={batches} options={options} uploads={uploads ?? []} />;
}
