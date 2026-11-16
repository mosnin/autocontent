"use client";

import { Clapperboard, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { retryJobAction } from "@/lib/actions";
import type { Job, Niche } from "@/lib/types";
import { decideInboxItem } from "../inbox/inbox-row";
import { List } from "../page";
import { Button, Chip, Empty, IconTile, Input, Select } from "../ui";
import { StatusWord, Time } from "./bits";
import { jobDot, jobStatusLabel, jobTitle, jobTone, matchesVideo, platformLabel, VIDEO_FILTERS, type VideoFilter } from "./status";

const PAGE = 20;

/** Approve / reject / retry for one video, in place. */
export function VideoActions({ job, size = "sm" }: { job: Pick<Job, "id" | "status">; size?: "sm" | "md" }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (what: "approve" | "reject" | "retry", e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (what === "reject" && !window.confirm("Reject this video? It will never post.")) return;
    setBusy(what);
    setError(null);
    try {
      if (what === "retry") {
        const fd = new FormData();
        fd.set("job_id", job.id);
        const res = await retryJobAction({ ok: false }, fd);
        if (!res.ok) throw new Error(res.error ?? "Retry failed");
      } else {
        await decideInboxItem({ kind: "video", ref_id: job.id }, what);
      }
      setDone(what === "approve" ? "Approved" : what === "reject" ? "Rejected" : "Retrying");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  if (done) return <span className="text-[13px] text-muted-foreground">{done}</span>;
  if (job.status === "failed")
    return (
      <span className="flex items-center gap-2">
        {error && <span className="text-[12px] text-destructive">{error}</span>}
        <Button size={size} onClick={(e) => void run("retry", e)} loading={busy === "retry"}>
          Retry
        </Button>
      </span>
    );
  if (job.status === "awaiting_approval")
    return (
      <span className="flex items-center gap-1.5">
        {error && <span className="text-[12px] text-destructive">{error}</span>}
        <Button size={size} variant="ghost" onClick={(e) => void run("reject", e)} disabled={busy !== null} loading={busy === "reject"}>
          Reject
        </Button>
        <Button size={size} variant="primary" onClick={(e) => void run("approve", e)} disabled={busy !== null} loading={busy === "approve"}>
          Approve
        </Button>
      </span>
    );
  return null;
}

export function VideoRow({ job, playbook }: { job: Job; playbook?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <IconTile>
        <Clapperboard />
      </IconTile>
      <Link href={`/content/videos/${job.id}`} className="min-w-0 flex-1 basis-[200px]">
        <div className="truncate text-[14px] font-medium">{jobTitle(job)}</div>
        <div className="truncate text-[13px] text-muted-foreground">
          {playbook ? `${playbook} · ` : ""}
          {platformLabel(job.platform)}
          <span className="text-faint">
            {" · "}
            <Time iso={job.created_at} />
          </span>
        </div>
        {job.status === "failed" && job.error && <div className="mt-0.5 line-clamp-2 text-[12px] text-destructive">{job.error}</div>}
      </Link>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <StatusWord label={jobStatusLabel(job.status)} tone={jobTone(job.status)} dot={jobDot(job.status)} />
        <VideoActions job={job} />
      </div>
    </div>
  );
}

export function VideosList({ jobs, niches, initialFilter = "all" }: { jobs: Job[]; niches: Niche[]; initialFilter?: VideoFilter }) {
  const [filter, setFilter] = useState<VideoFilter>(initialFilter);
  const [nicheId, setNicheId] = useState("");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const titles = useMemo(() => new Map(niches.map((n) => [n.id, n.title])), [niches]);

  const counts = useMemo(() => Object.fromEntries(VIDEO_FILTERS.map((f) => [f.value, jobs.filter((j) => matchesVideo(j, f.value)).length])), [jobs]);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return jobs.filter((j) => {
      if (!matchesVideo(j, filter)) return false;
      if (nicheId && j.niche_id !== nicheId) return false;
      if (!needle) return true;
      return [jobTitle(j), j.script?.idea?.topic ?? "", titles.get(j.niche_id) ?? "", j.id].some((s) => s.toLowerCase().includes(needle));
    });
  }, [jobs, filter, nicheId, q, titles]);

  if (jobs.length === 0) return <Empty art="files" title="No videos yet">Make one from a playbook, or ask the Content producer above.</Empty>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {VIDEO_FILTERS.map((f) => (
          <Chip key={f.value} selected={filter === f.value} onClick={() => (setFilter(f.value), setShown(PAGE))}>
            {f.label}
            <span className="tabular text-faint">{counts[f.value]}</span>
          </Chip>
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search hooks, topics, playbooks" aria-label="Search videos" className="pl-9" />
        </label>
        {niches.length > 1 && (
          <Select value={nicheId} onChange={(e) => setNicheId(e.target.value)} aria-label="Playbook" className="sm:w-56">
            <option value="">All playbooks</option>
            {niches.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title}
              </option>
            ))}
          </Select>
        )}
      </div>
      {visible.length === 0 ? (
        <p className="rounded-[14px] bg-subtle px-4 py-5 text-[13px] text-muted-foreground">No videos match. Try another filter.</p>
      ) : (
        <List>
          {visible.slice(0, shown).map((j) => (
            <VideoRow key={j.id} job={j} playbook={titles.get(j.niche_id)} />
          ))}
        </List>
      )}
      {visible.length > shown && (
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => setShown((s) => s + PAGE)}>
            Show {Math.min(PAGE, visible.length - shown)} more
          </Button>
        </div>
      )}
    </div>
  );
}
