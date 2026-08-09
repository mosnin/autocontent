import { api } from "@/lib/api";
import type { Persona } from "@/lib/personas-client";
import type { Niche } from "@/lib/types";
import { PersonasClient } from "./PersonasClient";

export const dynamic = "force-dynamic";

export default async function Personas() {
  // Both fall back to empty rather than throwing: a persona is an
  // account-level asset, so the page must still render (and offer the
  // create form) on a deploy where nothing has been set up yet.
  const [personas, niches] = await Promise.all([
    api<Persona[]>("/api/v1/personas").catch(() => []),
    api<Niche[]>("/api/v1/niches").catch(() => []),
  ]);

  return <PersonasClient initialPersonas={personas} niches={niches} />;
}
