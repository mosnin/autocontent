"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowRight, Clapperboard } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { clientFetch } from "@/lib/client-fetcher";
import type { Job } from "@/lib/types";

const POLL_MS = 15000;
const FIRST_VIDEO_KEY = "autocontent_first_video_seen";

function videoSrc(jobId: string): string {
  return `/api/proxy/api/v1/jobs/${jobId}/video`;
}

/**
 * "Latest videos" — the machine's actual output, front and center on the
 * dashboard. Also owns the first-video moment: the first time a done job
 * ever appears for this browser, we stop everything and play it.
 */
export function LatestVideos() {
  const { data } = useSWR<Job[]>(
    "/api/v1/jobs?status_filter=done&limit=6",
    clientFetch,
    { refreshInterval: POLL_MS },
  );

  const done = data ?? [];
  const [revealJob, setRevealJob] = React.useState<Job | null>(null);

  // First-video celebration: fires once per browser, only when at least
  // one finished video exists.
  React.useEffect(() => {
    if (done.length === 0) return;
    try {
      if (localStorage.getItem(FIRST_VIDEO_KEY)) return;
      localStorage.setItem(FIRST_VIDEO_KEY, new Date().toISOString());
      setRevealJob(done[0]);
    } catch {
      // Storage unavailable (private mode) — skip the moment, never break.
    }
  }, [done]);

  if (done.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Latest videos</h2>
        <Button asChild size="sm" variant="ghost">
          <Link href="/queue">
            All jobs
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {done.slice(0, 6).map((job) => (
          <Link
            aria-label={`Watch video from job ${job.id.slice(0, 8)}`}
            className="group w-40 shrink-0"
            href={`/queue/${job.id}`}
            key={job.id}
          >
            <div className="overflow-hidden rounded-xl border border-border/60 bg-black transition-colors group-hover:border-brand/40">
              <video
                className="aspect-[9/16] w-full object-cover"
                muted
                playsInline
                preload="metadata"
                src={videoSrc(job.id)}
              />
            </div>
            <p className="mt-1.5 truncate text-xs text-muted-foreground group-hover:text-foreground">
              {job.script?.idea?.hook ?? job.id.slice(0, 8)}
            </p>
          </Link>
        ))}
      </div>

      {/* The first-video moment. */}
      <Dialog
        onOpenChange={(open) => {
          if (!open) setRevealJob(null);
        }}
        open={revealJob !== null}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span aria-hidden className="relative flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
                <span className="relative inline-flex size-2.5 rounded-full bg-brand" />
              </span>
              Your machine shipped its first video
            </DialogTitle>
            <DialogDescription>
              Ideated, written, animated, voiced, and mixed — start to finish,
              no hands on the wheel.
            </DialogDescription>
          </DialogHeader>
          {revealJob && (
            <div className="overflow-hidden rounded-xl border border-border/60 bg-black">
              <video
                autoPlay
                className="aspect-[9/16] w-full object-cover"
                controls
                playsInline
                src={videoSrc(revealJob.id)}
              />
            </div>
          )}
          <Button asChild>
            <Link href={revealJob ? `/queue/${revealJob.id}` : "/queue"}>
              <Clapperboard className="size-4" />
              See the full breakdown
            </Link>
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
