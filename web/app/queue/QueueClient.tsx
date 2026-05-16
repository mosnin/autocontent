"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import useSWR from "swr";

import { EMPTY_STATE, type ActionState } from "../../lib/action-state";
import { retryJobAction } from "../../lib/actions";
import { clientFetch } from "../../lib/client-fetcher";
import type { Job, JobStatus } from "../../lib/types";
import { StatusBadge, statusColor } from "../components/StatusBadge";

const ORDER: JobStatus[] = [
  "queued",
  "ideating",
  "scripting",
  "generating_images",
  "animating",
  "voicing",
  "editing",
  "captioning",
  "qa",
  "scheduling",
  "done",
  "failed",
];

const POLL_MS = 5000;

export function QueueClient({ initial }: { initial: Job[] }) {
  const { data, error } = useSWR<Job[]>("/api/v1/jobs?limit=100", clientFetch, {
    refreshInterval: POLL_MS,
    fallbackData: initial,
  });

  const jobs = data ?? [];

  const grouped: Record<JobStatus, Job[]> = Object.fromEntries(
    ORDER.map((s) => [s, [] as Job[]]),
  ) as Record<JobStatus, Job[]>;
  for (const j of jobs) grouped[j.status].push(j);

  return (
    <section>
      <h1>Queue</h1>
      {error && (
        <div style={errorBannerStyle}>
          Live updates paused: {error.message ?? "fetch failed"}
        </div>
      )}
      {jobs.length === 0 ? (
        <p>
          No jobs yet. Trigger one from the <a href="/dashboard">dashboard</a>.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {ORDER.filter((s) => grouped[s].length > 0).map((status) => (
            <details
              key={status}
              open={status !== "done"}
              style={groupStyle}
            >
              <summary style={{ ...summaryStyle, color: statusColor(status) }}>
                {status} ({grouped[status].length})
              </summary>
              <ul style={{ padding: 0, display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                {grouped[status].map((j) => (
                  <JobRow key={j.id} job={j} />
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

function JobRow({ job }: { job: Job }) {
  return (
    <li style={rowStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <StatusBadge status={job.status} />
          <code style={{ fontSize: 12, color: "#666" }}>{job.id.slice(0, 8)}</code>
          <span>{job.platform}</span>
          <span style={{ color: "#666", fontSize: 13 }}>
            {new Date(job.created_at).toLocaleString()}
          </span>
        </div>
        {job.status === "failed" && <RetryForm jobId={job.id} />}
      </div>
      {job.script?.idea?.hook && (
        <div style={{ marginTop: 6, fontStyle: "italic" }}>&ldquo;{job.script.idea.hook}&rdquo;</div>
      )}
      {job.error && <pre style={errorStyle}>{job.error}</pre>}
      {job.scheduled_for && (
        <div style={{ marginTop: 6, color: "#666", fontSize: 13 }}>
          Scheduled for {new Date(job.scheduled_for).toLocaleString()}
          {job.provider_post_id && (
            <span style={{ marginLeft: 8 }}>
              · post id <code>{job.provider_post_id}</code>
            </span>
          )}
        </div>
      )}
    </li>
  );
}

function RetryForm({ jobId }: { jobId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    retryJobAction,
    EMPTY_STATE,
  );
  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
      <input type="hidden" name="job_id" value={jobId} />
      <RetrySubmit />
      {state.error && <span style={inlineErrorStyle}>{state.error}</span>}
    </form>
  );
}

function RetrySubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} style={retryButtonStyle}>
      {pending ? "Retrying…" : "Retry"}
    </button>
  );
}

const groupStyle: React.CSSProperties = {
  border: "1px solid #eee",
  borderRadius: 8,
  padding: "8px 12px",
  background: "#fafafa",
};
const summaryStyle: React.CSSProperties = {
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 14,
  textTransform: "lowercase",
  userSelect: "none",
};
const rowStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 12,
  border: "1px solid #e5e5e5",
  borderRadius: 8,
  background: "white",
};
const retryButtonStyle: React.CSSProperties = {
  padding: "4px 10px",
  background: "#c33",
  color: "white",
  border: 0,
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};
const errorStyle: React.CSSProperties = {
  marginTop: 8,
  padding: 8,
  background: "#fdecec",
  color: "#933",
  borderRadius: 4,
  fontSize: 12,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};
const errorBannerStyle: React.CSSProperties = {
  background: "#fdecec",
  border: "1px solid #f4b6b6",
  color: "#933",
  padding: 8,
  borderRadius: 6,
  margin: "8px 0",
  fontSize: 13,
};
const inlineErrorStyle: React.CSSProperties = {
  color: "#933",
  fontSize: 12,
};
