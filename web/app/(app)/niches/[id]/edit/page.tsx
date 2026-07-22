import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/square/ui/button";
import { api } from "@/lib/api";
import type { Niche } from "@/lib/types";
import { EditNicheForm } from "./EditNicheForm";

export const dynamic = "force-dynamic";

async function fetchNiche(id: string): Promise<Niche | null> {
  try {
    return await api<Niche>(`/api/v1/niches/${id}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("404")) return null;
    throw e;
  }
}

export default async function EditNichePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const niche = await fetchNiche(id);
  if (!niche) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/dashboard">
          Back to dashboard
        </Link>
      </Button>
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
          Edit niche
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {niche.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Adjust any field below and save. The pipeline picks up the new
          settings on the next run.
        </p>
      </div>
      <EditNicheForm niche={niche} />
    </div>
  );
}
