import { api } from "@/lib/api";
import type { Kit } from "@/lib/types";
import { KitsClient } from "./KitsClient";

export const dynamic = "force-dynamic";

export default async function KitsPage() {
  const kits = await api<Kit[]>("/api/v1/kits");
  return <KitsClient initial={kits} />;
}
