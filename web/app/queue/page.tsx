import { api } from "../../lib/api";
import { retryJobAction } from "../../lib/actions";
import type { Job, JobStatus } from "../../lib/types";

export const dynamic = "force-dynamic";

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

const STATUS_COLORS: Record<JobStatus, string> = {
  queued: "#888",
  ideating: "#48f",
  scripting: "#48f",
  generating_images: "#48f",
  animating: "#48f",
  voicing: "#48f",
  editing: "#48f",
  captioning: "#48f",
  qa: "#48f",
  scheduling: "#48f",
  done: "#0a7",
  failed: "#c33",
};

export default async function Queue() {
  const jobs = await api<Job[]>("/api/v1/jobs?limit=100");

  const grouped: Record<JobStatus, Job[]> = Object.fromEntries(
    ORDER.map((s) => [s, [] as Job[]]),
  ) as Record<JobStatus, Job[]>;
  for (const j of jobs) grouped[j.status].push(j);

  return (
    <section>
      <h1>Queue</h1>
      {jobs.length === 0 ? (
        <p>
          No jobs yet. Trigger one from the <a href="/dashboard">dashboard</a>.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {ORDER.filter((s) => grouped[s].length > 0).map((status) => (
            <section key={status}>
              <h3 style={{ color: STATUS_COLORS[status], margin: "0 0 8px" }}>
                {status} ({grouped[status].length})
              </h3>
              <ul style={{ padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {grouped[status].map((j) => (
                  <JobRow key={j.id} job={j} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function JobRow({ job }: { job: Job }) {
  return (
    <li style={rowStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <code style={{ fontSize: 12, color: "#666" }}>{job.id.slice(0, 8)}</code>
          <span style={{ marginLeft: 8 }}>{job.platform}</span>
          <span style={{ marginLeft: 8, color: "#666", fontSize: 13 }}>
            {new Date(job.created_at).toLocaleString()}
          </span>
        </div>
        {job.status === "failed" && (
          <form action={retryJobAction}>
            <input type="hidden" name="job_id" value={job.id} />
            <button type="submit" style={retryButtonStyle}>
              Retry
            </button>
          </form>
        )}
      </div>
      {job.script?.idea?.hook && (
        <div style={{ marginTop: 6, fontStyle: "italic" }}>“{job.script.idea.hook}”</div>
      )}
      {job.error && (
        <pre style={errorStyle}>{job.error}</pre>
      )}
      {job.scheduled_for && (
        <div style={{ marginTop: 6, color: "#666", fontSize: 13 }}>
          Scheduled for {new Date(job.scheduled_for).toLocaleString()}
          {job.provider_post_id && (
            <span style={{ marginLeft: 8 }}>· post id <code>{job.provider_post_id}</code></span>
          )}
        </div>
      )}
    </li>
  );
}

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
