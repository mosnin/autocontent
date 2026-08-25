import { api } from "@/lib/api";
import type { Drama } from "@/lib/dramas-client";
import type { Niche } from "@/lib/types";
import { DramasClient } from "./DramasClient";

export const dynamic = "force-dynamic";

export default async function DramasPage() {
  let dramas: Drama[] = [];
  try {
    dramas = await api<Drama[]>("/api/v1/dramas?limit=50");
  } catch {
    dramas = [];
  }

  let niches: Niche[] = [];
  try {
    niches = await api<Niche[]>("/api/v1/niches");
  } catch {
    niches = [];
  }

  return <DramasClient initialDramas={dramas} niches={niches} />;
}
