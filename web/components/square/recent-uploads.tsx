// Square UI "marketing-dashboard" template recent-uploads, ported verbatim
// — same card chrome, 4:5 tile strip, bottom gradient, and the floating
// label bar. Changes are real-data parameterization only:
//   - the template's mock `recentUploads` become the `uploads` prop fed by
//     the page from live jobs data;
//   - the mock <img> thumbnail becomes a real <video> preview using the
//     /api/proxy/api/v1/jobs/{id}/video pattern (same as latest-videos);
//   - jobs carry no per-video view count, so the label slot shows the real
//     video title (hook) instead of an invented "N views";
//   - each tile links to the real job detail page.

import Link from "next/link";
import { Upload } from "lucide-react";

export interface RecentUpload {
  id: string;
  /** Real video title (script hook) shown in the label bar. */
  title: string;
  /** Real relative age derived from the job's created_at. */
  timeAgo: string;
  /** Real video stream URL (proxy pattern from latest-videos). */
  videoSrc: string;
  /** Real destination — the job's detail page. */
  href: string;
}

export function RecentUploads({ uploads }: { uploads: RecentUpload[] }) {
  return (
    <div className="rounded-lg border bg-card p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Recent uploads</span>
        <Upload className="size-3.5 text-muted-foreground" />
      </div>
      <div className="w-full flex gap-2 h-full">
        {uploads.length === 0 && (
          <p className="text-sm text-muted-foreground">No uploads yet.</p>
        )}
        {uploads.map((upload) => (
          <Link
            key={upload.id}
            href={upload.href}
            aria-label={`Watch ${upload.title}`}
            className="relative rounded-lg overflow-hidden aspect-4/5 group cursor-pointer border border-white/20 h-full"
          >
            <video
              muted
              playsInline
              preload="metadata"
              src={upload.videoSrc}
              className="object-cover transition-transform duration-300 w-full h-full"
            />
            <div className="absolute inset-0 bg-linear-to-b from-transparent from-60% to-black/70" />
            <div className="absolute bottom-[6px] left-[4px] right-[4px] bg-background rounded-md px-2.5 py-1.5 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-foreground truncate">
                {upload.title}
              </span>
              <span className="text-[10px] font-medium text-muted-foreground border border-border rounded px-1.5 py-0.5 shrink-0 bg-muted/50">
                {upload.timeAgo}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
