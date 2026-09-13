import { api } from "@/lib/api";
import { ProductionWorkbench } from "@/components/production/production-workbench";
import type { ProductionRecord } from "@/lib/production";

export const dynamic = "force-dynamic";
export default async function ProductionDetail({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const initial = await api<ProductionRecord>(`/api/v1/production/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`);
  return <ProductionWorkbench initial={initial} />;
}
