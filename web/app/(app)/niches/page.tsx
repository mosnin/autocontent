import Link from "next/link";

import { Button } from "@/components/square/ui/button";
import { DashHeading } from "@/components/hub/dashboard-kit";
import { api } from "@/lib/api";
import type { Niche } from "@/lib/types";
import { NichesTable } from "./NichesTable";

export const dynamic = "force-dynamic";

// Standalone Niches collection page. Rebuilt on the Square UI
// marketing-dashboard template's campaigns-table anatomy (search +
// filter toolbar, sortable columns, pagination footer) — see
// ./NichesTable. Each row links to the niche detail (`/niches/[id]`);
// the toolbar's primary action routes to /onboarding, our real
// niche-creation flow.
export default async function NichesPage() {
  const niches = await api<Niche[]>("/api/v1/niches");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <DashHeading as="h1" sub="Every niche you run, each its own self-driving pipeline.">
          Niches
        </DashHeading>
        {niches.length === 0 && (
          <Button asChild>
            <Link href="/onboarding">Create niche</Link>
          </Button>
        )}
      </div>

      {niches.length === 0 ? <EmptyState /> : <NichesTable niches={niches} />}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed bg-card p-12 text-center">
      <h3 className="text-lg font-semibold">No niches yet</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        Create one to start the pipeline. You can have as many as you want;
        each runs under its own daily spend cap.
      </p>
      <Button asChild className="mt-4">
        <Link href="/onboarding">Create your first niche</Link>
      </Button>
    </div>
  );
}
