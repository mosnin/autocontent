import { EmptyLine, PageHeader } from "@/design-system";
import { TrackerTableView } from "@/components/app/tracker/table-view";
import { type Member, type RowPage, type TrackerTable, type TrackerTableSummary, rowsPath } from "@/lib/tracker";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Tracker · Marketer" };

export default async function TrackerTablePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string; row?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const table = await safe<TrackerTable>(`/api/v1/tracker/tables/${encodeURIComponent(id)}`);
  if (!table) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader crumbs={[{ label: "Tracker", href: "/tracker" }, { label: "Not found" }]} />
        <div className="p-6">
          <EmptyLine>This table doesn't exist in this workspace, or it was deleted.</EmptyLine>
        </div>
      </div>
    );
  }
  const view = table.views.find((v) => v.id === sp.view) ?? table.views[0];
  const [page, tables, members] = await Promise.all([
    safe<RowPage>(rowsPath(table.id, { filters: view?.filters, filterType: view?.filter_type, sorts: view?.sorts, limit: 500 })),
    safe<TrackerTableSummary[]>("/api/v1/tracker/tables"),
    safe<Member[]>("/api/v1/tracker/members"),
  ]);
  return <TrackerTableView key={table.id} table={table} tables={tables ?? [table]} page={page} members={members ?? []} initialViewId={view?.id} initialRowId={sp.row} />;
}
