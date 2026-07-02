"use client";

import { useRouter } from "next/navigation";
import {
  ChevronRight,
  Instagram,
  Music2,
  Youtube,
  type LucideIcon,
} from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/lib/status-badge";
import type { Job, Platform } from "@/lib/types";

const PLATFORM_META: Record<Platform, { label: string; icon: LucideIcon }> = {
  tiktok: { label: "TikTok", icon: Music2 },
  reels: { label: "Reels", icon: Instagram },
  shorts: { label: "Shorts", icon: Youtube },
};

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

export function RecentJobsTable({ jobs }: { jobs: Job[] }) {
  const router = useRouter();

  if (jobs.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        A run hasn&apos;t happened yet.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-9 w-[150px] text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Status
          </TableHead>
          <TableHead className="h-9 w-[110px] text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Job ID
          </TableHead>
          <TableHead className="h-9 w-[120px] text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Platform
          </TableHead>
          <TableHead className="h-9 text-right text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Created
          </TableHead>
          <TableHead className="h-9 w-[40px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => {
          const meta = PLATFORM_META[job.platform];
          const Icon = meta?.icon;
          return (
            <TableRow
              key={job.id}
              onClick={() => router.push(`/queue/${job.id}`)}
              className="group cursor-pointer transition-colors hover:bg-muted/40"
            >
              <TableCell className="py-2.5">
                <StatusBadge status={job.status} />
              </TableCell>
              <TableCell className="py-2.5">
                <code className="font-mono text-xs tabular-nums text-muted-foreground">
                  {job.id.slice(0, 8)}
                </code>
              </TableCell>
              <TableCell className="py-2.5">
                <span className="flex items-center gap-1.5 text-sm">
                  {Icon && (
                    <Icon className="size-3.5 text-muted-foreground" />
                  )}
                  {meta?.label ?? job.platform}
                </span>
              </TableCell>
              <TableCell className="py-2.5 text-right font-mono text-xs tabular-nums text-muted-foreground">
                {relative(job.created_at)}
              </TableCell>
              <TableCell className="py-2.5 text-right">
                <ChevronRight className="ml-auto size-4 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
