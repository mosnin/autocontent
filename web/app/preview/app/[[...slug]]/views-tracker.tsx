// Preview views for the Tracker. key = path after /preview/app/.
import type { ReactNode } from "react";
import { TrackerTableView } from "@/components/app/tracker/table-view";
import { TrackerHome } from "@/components/app/tracker/tracker-home";
import { AB, CAL, FX_AB, FX_CALENDAR, FX_CAMPAIGNS, FX_TRACKER_MEMBERS, FX_TRACKER_PREVIEW, FX_TRACKER_TABLES, FX_TRACKER_TEMPLATES } from "@/lib/fixtures-tracker";
import type { TrackerTable } from "@/lib/tracker";

const table = (t: TrackerTable, viewIndex = 0, rowId?: string) => (
  <TrackerTableView key={`${t.id}-${viewIndex}-${rowId ?? ""}`} preview={FX_TRACKER_PREVIEW} table={t} tables={FX_TRACKER_TABLES} page={null} members={FX_TRACKER_MEMBERS} initialViewId={t.views[viewIndex]?.id} initialRowId={rowId} />
);

export const VIEWS: Record<string, () => ReactNode> = {
  tracker: () => <TrackerHome preview tables={FX_TRACKER_TABLES} templates={FX_TRACKER_TEMPLATES} />,
  "tracker/empty": () => <TrackerHome preview tables={[]} templates={FX_TRACKER_TEMPLATES} />,
  [`tracker/${CAL}`]: () => table(FX_CALENDAR, 0),
  "tracker/content-calendar": () => table(FX_CALENDAR, 0),
  "tracker/content-calendar/board": () => table(FX_CALENDAR, 1),
  "tracker/content-calendar/calendar": () => table(FX_CALENDAR, 2),
  "tracker/content-calendar/gallery": () => table(FX_CALENDAR, 3),
  "tracker/content-calendar/row": () => table(FX_CALENDAR, 0, FX_TRACKER_PREVIEW.rowsByTable[CAL]![3]!.id),
  [`tracker/${AB}`]: () => table(FX_AB, 0),
  "tracker/ab-tests": () => table(FX_AB, 0),
  [`tracker/${FX_CAMPAIGNS.id}`]: () => table(FX_CAMPAIGNS, 0),
  // A table started from a template in the preview opens the matching fixture.
  "tracker/t-content_calendar": () => table(FX_CALENDAR, 2),
  "tracker/t-ab_tests": () => table(FX_AB, 0),
  "tracker/t-campaigns": () => table(FX_CAMPAIGNS, 0),
};
