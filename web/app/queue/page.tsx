import { api } from "../../lib/api";
import type { Job } from "../../lib/types";
import { QueueClient } from "./QueueClient";

export const dynamic = "force-dynamic";

export default async function Queue() {
  const jobs = await api<Job[]>("/api/v1/jobs?limit=100");
  return <QueueClient initial={jobs} />;
}
