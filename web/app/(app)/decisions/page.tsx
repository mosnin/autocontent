import { api } from "@/lib/api";
import type { JevStatus } from "@/lib/jev-types";
import { DecisionsClient } from "./DecisionsClient";

export const dynamic = "force-dynamic";

export default async function DecisionsPage() {
  let status: JevStatus | null = null;
  try {
    status = await api<JevStatus>("/api/v1/jev/status");
  } catch {
    status = null;
  }
  return <DecisionsClient initial={status} />;
}
