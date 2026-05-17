"use client";

import Link from "next/link";
import { ArrowUpRight, Inbox } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/lib/status-badge";
import type { Job } from "@/lib/types";

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
  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <div className="rounded-full bg-muted p-3">
          <Inbox className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">No jobs yet for this niche.</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[140px]">Status</TableHead>
          <TableHead className="w-[110px]">Job ID</TableHead>
          <TableHead className="w-[110px]">Platform</TableHead>
          <TableHead className="w-[130px]">Created</TableHead>
          <TableHead className="w-[100px] text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
          <TableRow key={job.id}>
            <TableCell>
              <StatusBadge status={job.status} />
            </TableCell>
            <TableCell>
              <code className="font-mono text-xs text-muted-foreground">
                {job.id.slice(0, 8)}
              </code>
            </TableCell>
            <TableCell className="capitalize">{job.platform}</TableCell>
            <TableCell className="text-muted-foreground">
              {relative(job.created_at)}
            </TableCell>
            <TableCell className="text-right">
              <Button asChild size="sm" variant="ghost">
                <Link href={`/queue/${job.id}`}>
                  View
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
