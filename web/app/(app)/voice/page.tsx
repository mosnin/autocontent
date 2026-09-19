import { api } from "@/lib/api";
import type { VoiceStatus } from "@/lib/jev-types";
import { VoiceClient } from "./VoiceClient";

export const dynamic = "force-dynamic";

export default async function VoicePage() {
  let status: VoiceStatus | null = null;
  try {
    status = await api<VoiceStatus>("/api/v1/voice/status");
  } catch {
    status = null;
  }
  return <VoiceClient initial={status} />;
}
