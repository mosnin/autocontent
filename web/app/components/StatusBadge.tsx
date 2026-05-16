import { Badge, type MantineColor } from "@mantine/core";

import type { JobStatus } from "../../lib/types";

const STATUS_MANTINE_COLOR: Record<JobStatus, MantineColor> = {
  queued: "gray",
  ideating: "blue",
  scripting: "blue",
  generating_images: "blue",
  animating: "blue",
  voicing: "blue",
  editing: "blue",
  captioning: "blue",
  qa: "blue",
  scheduling: "blue",
  done: "green",
  failed: "red",
};

export function statusColor(status: JobStatus): MantineColor {
  return STATUS_MANTINE_COLOR[status];
}

export function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <Badge color={STATUS_MANTINE_COLOR[status]} variant="light" radius="sm">
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
