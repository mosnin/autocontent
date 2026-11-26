"use client";

import { Clapperboard, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, ConfirmModal, EmptyLine, FilterPill, Input, List, ListRow, Section, StatusBadge, Thumb, Time, Notice } from "@/design-system";
import { retryJobAction } from "@/lib/actions";
import { proxyFetch } from "@/lib/proxy-fetch";
import type { Job, Niche } from "@/lib/types";
import { JOB_IN_PROGRESS, jobStatusLabel, jobTitle, jobTone, matchesVideo, platformLabel, VIDEO_FILTERS, type VideoFilter } from "./status";

const PAGE = 20;

/** Approve, reject or retry one video in place. */
export function VideoActions({ job, size = "sm" }: { job: Pick<Job, "id" | "status">; size?: "sm" | "md" }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const run = async (what: "approve" | "reject" | "retry") => {
    setBusy(what);
    setError(null);
    try {
      if (what === "retry") {
        const fd = new FormData();
        fd.set("job_id", job.id);
        const res = await retryJobAction({ ok: false }, fd);
        if (!res.ok) throw new Error(res.error ?? "Retry failed");
      } else {
        await proxyFetch(`/api/v1/workspace/inbox/video/${encodeURIComponent(job.id)}/decide`, "POST", { decision: what });
      }
      setDone(what === "approve" ? "Approved" : what === "reject" ? "Rejected" : "Retrying");
      setConfirm(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  if (done) return <span className="text-[12.5px] text-fg-muted">{done}</span>;
  if (job.status === "failed")
    return (
      <span className="flex items-center gap-2">
        {error && <Notice inline error={error} />}
        <Button size={size} onClick={() => void run("retry")} loading={busy === "retry"}>
          Retry
        </Button>
      </span>
    );
  if (job.status === "awaiting_approval")
    return (
      <span className="flex items-center gap-1.5">
        {error && !confirm && <Notice inline error={error} />}
        <Button size={size} variant="ghost" onClick={() => setConfirm(true)} disabled={busy !== null}>
          Reject
        </Button>
        <Button size={size} variant="primary" onClick={() => void run("approve")} disabled={busy !== null} loading={busy === "approve"}>
          Approve
        </Button>
        <ConfirmModal open={confirm} onClose={() => setConfirm(false)} title="Reject this video?" confirmLabel="Reject" danger busy={busy === "reject"} error={error} onConfirm={() => void run("reject")}>
          It will never post.
        </ConfirmModal>
      </span>
    );
  return null;
}

/** One video: a 9:16 thumb, the hook, where it's from, status and actions. */
export function VideoRow({ job, playbook }: { job: Job; playbook?: string }) {
  return (
    <ListRow className="flex-wrap gap-y-2">
      <Thumb ratio="9/16" className="w-[26px] shrink-0">
        <span className="absolute inset-0 flex items-center justify-center text-fg-faint [&_svg]:size-3">
          <Clapperboard />
        </span>
      </Thumb>
      <Link href={`/content/videos/${job.id}`} className="min-w-0 flex-1 basis-[180px]">
        <div className="truncate text-[13px] font-medium hover:underline">{jobTitle(job)}</div>
        <div className="truncate text-[12px] text-fg-muted">
          {playbook ? `${playbook} · ` : ""}
          {platformLabel(job.platform)}
          {" · "}
          <Time iso={job.created_at} />
        </div>
        {job.status === "failed" && job.error && <div className="mt-0.5 line-clamp-1 text-[12px] text-negative">{job.error}</div>}
      </Link>
      <div className="ml-auto flex shrink-0 items-center gap-2.5">
        {/* Approve/Reject already say "needs approval", a failure shows its reason in red, and a finished video needs no badge. */}
        {job.status !== "awaiting_approval" && job.status !== "done" && !(job.status === "failed" && job.error) && <StatusBadge tone={jobTone(job.status)}>{jobStatusLabel(job.status)}</StatusBadge>}
        <VideoActions job={job} />
      </div>
    </ListRow>
  );
}

function Rows({ jobs, titles, limit }: { jobs: Job[]; titles: Map<string, string>; limit?: number }) {
  const [shown, setShown] = useState(limit ?? jobs.length);
  return (
    <>
      <List>
        {jobs.slice(0, shown).map((j) => (
          <VideoRow key={j.id} job={j} playbook={titles.get(j.niche_id)} />
        ))}
      </List>
      {jobs.length > shown && (
        <div className="mt-2 flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => setShown((s) => s + PAGE)}>
            Show {Math.min(PAGE, jobs.length - shown)} more
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * Videos: one toolbar (search, a status filter, a playbook filter). With "All", the work is
 * grouped into Needs approval, In progress and Recent.
 */
export function VideosList({ jobs, niches, initialFilter = "all" }: { jobs: Job[]; niches: Niche[]; initialFilter?: VideoFilter }) {
  const [filter, setFilter] = useState<VideoFilter>(initialFilter);
  const [nicheId, setNicheId] = useState("");
  const [q, setQ] = useState("");
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

  if (jobs.length === 0) return <EmptyLine>No videos yet. Make one from a playbook, or ask above.</EmptyLine>;

  const waiting = visible.filter((j) => j.status === "awaiting_approval");
  const working = visible.filter((j) => JOB_IN_PROGRESS.has(j.status));
  const rest = visible.filter((j) => j.status !== "awaiting_approval" && !JOB_IN_PROGRESS.has(j.status));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search hooks, topics, playbooks" aria-label="Search videos" className="pl-8" />
        </label>
        <FilterPill label="Status" value={filter} onChange={setFilter} options={VIDEO_FILTERS.map((f) => ({ value: f.value, label: f.value === "all" ? `All statuses · ${counts[f.value]}` : `${f.label} · ${counts[f.value]}` }))} />
        {niches.length > 1 && <FilterPill label="Playbook" value={nicheId} onChange={setNicheId} options={[{ value: "", label: "All playbooks" }, ...niches.map((n) => ({ value: n.id, label: n.title }))]} />}
      </div>

      {visible.length === 0 ? (
        <EmptyLine>No videos match. Try another filter.</EmptyLine>
      ) : filter !== "all" ? (
        <Rows jobs={visible} titles={titles} limit={PAGE} />
      ) : (
        <>
          {waiting.length > 0 && (
            <Section title="Needs approval" count={waiting.length}>
              <Rows jobs={waiting} titles={titles} />
            </Section>
          )}
          {working.length > 0 && (
            <Section title="In progress" count={working.length}>
              <Rows jobs={working} titles={titles} />
            </Section>
          )}
          {rest.length > 0 && (
            <Section title="Recent">
              <Rows jobs={rest} titles={titles} limit={PAGE} />
            </Section>
          )}
        </>
      )}
    </div>
  );
}
