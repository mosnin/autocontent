"use client";

import { Plus } from "lucide-react";
import type { TrackerRow } from "@/lib/tracker";
import { RowCard, cardFields } from "./board-view";
import { useTracker } from "./context";
import type { RowOps, ViewSettings } from "./table-view";

/** Gallery: one card per row, a few fields each. Good for briefs and creative. */
export function GalleryView({ rows, settings, ops }: { rows: TrackerRow[]; settings: ViewSettings; ops: RowOps }) {
  const { table, canEdit } = useTracker();
  const fields = cardFields(table.fields, settings, [], 5);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {rows.map((r) => (
          <li key={r.id}>
            <RowCard row={r} fields={fields} onOpen={() => ops.openRow(r.id)} />
          </li>
        ))}
        {canEdit && (
          <li>
            <button
              type="button"
              onClick={async () => {
                const r = await ops.createRow();
                if (r) ops.openRow(r.id);
              }}
              className="ds-press flex h-full min-h-20 w-full items-center justify-center gap-1.5 rounded-ds-md border border-hairline text-[13px] text-fg-muted hover:border-hairline-strong hover:text-fg [&_svg]:size-3.5"
            >
              <Plus /> New
            </button>
          </li>
        )}
      </ul>
      {rows.length === 0 && !canEdit && <p className="text-[13px] text-fg-muted">No rows match this view.</p>}
    </div>
  );
}
