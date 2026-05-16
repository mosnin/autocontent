import type { JobStatus } from "../../lib/types";

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

export function statusColor(status: JobStatus): string {
  return STATUS_COLORS[status];
}

export function StatusBadge({ status }: { status: JobStatus }) {
  const color = STATUS_COLORS[status];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 10,
        background: color,
        color: "white",
        fontSize: 12,
        fontWeight: 600,
        textTransform: "lowercase",
      }}
    >
      {status}
    </span>
  );
}
