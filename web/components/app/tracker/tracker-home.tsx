"use client";

import { CalendarDays, ClipboardList, FlaskConical, Megaphone, MessageSquareText, Palette, Plus, Table2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Button, CollectionCard, Column, EmptyLine, Notice, NotAllowed, Section, Time, cx, useAllowed, usePending } from "@/design-system";
import { VIEW_LABEL, type TemplateInfo, type TrackerTableSummary } from "@/lib/tracker";
import { trackerApi } from "@/lib/tracker-client";

export const TEMPLATE_ICON: Record<string, ReactNode> = {
  content_calendar: <CalendarDays />,
  social_posts: <MessageSquareText />,
  ab_tests: <FlaskConical />,
  campaigns: <Megaphone />,
  launch_checklist: <ClipboardList />,
  creative_briefs: <Palette />,
};

/** /tracker: the team's tables, then templates to start one in a click. */
export function TrackerHome({ tables, templates, loadError, preview }: { tables: TrackerTableSummary[]; templates: TemplateInfo[]; loadError?: boolean; preview?: boolean }) {
  const router = useRouter();
  const canCreate = useAllowed("playbook:create");
  const { busy, error, run } = usePending<string>();
  const base = preview ? "/preview/app/tracker" : "/tracker";

  const start = (key: string) =>
    run(key, async () => {
      if (preview) return router.push(`${base}/t-${key}`);
      const t = key === "blank" ? await trackerApi.createTable("Untitled table") : await trackerApi.fromTemplate(key);
      router.push(`/tracker/${t.id}`);
    });

  const templateGrid = (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {templates.map((t, i) => (
        <li key={t.key} className="ds-enter" style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}>
          <button
            type="button"
            disabled={!canCreate || busy !== null}
            onClick={() => void start(t.key)}
            aria-busy={busy === t.key}
            className={cx("ds-press block h-full w-full rounded-ds-lg border border-hairline bg-surface p-4 text-left enabled:hover:border-hairline-strong disabled:cursor-default", busy === t.key && "opacity-60")}
          >
            <span className="flex items-start gap-2.5">
              <span className="mt-px flex shrink-0 text-fg-muted [&_svg]:size-4">{TEMPLATE_ICON[t.key] ?? <Table2 />}</span>
              <span className="min-w-0">
                <span className="block text-[14px] font-medium">{t.name}</span>
                <span className="mt-1 block text-[13px] leading-relaxed text-fg-muted">{t.description}</span>
                <span className="mt-3 block text-[12px] text-fg-faint">
                  {[...new Set(t.views)].map((v) => VIEW_LABEL[v]).join(" · ")} · {t.fields.length} fields
                </span>
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <Column
      width="lg"
      title="Tracker"
      description="Tables for the work around the work: what's planned, what shipped, what you tested."
      actions={
        canCreate ? (
          <Button onClick={() => void start("blank")} loading={busy === "blank"}>
            <Plus /> Blank table
          </Button>
        ) : undefined
      }
    >
      {error && <Notice error={error} />}
      {loadError ? (
        <EmptyLine>Couldn't load your tables. Refresh to try again.</EmptyLine>
      ) : tables.length > 0 ? (
        <Section title="Your tables">
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tables.map((t) => (
              <li key={t.id}>
                <CollectionCard
                  href={`${base}/${t.id}`}
                  icon={(t.template && TEMPLATE_ICON[t.template]) || <Table2 />}
                  title={t.name}
                  description={t.description || undefined}
                  footer={
                    <>
                      <span className="tabular">{(t.row_count ?? 0).toLocaleString()} rows</span>
                      <span>
                        Updated <Time iso={t.updated_at} />
                      </span>
                    </>
                  }
                  className="h-full"
                />
              </li>
            ))}
          </ul>
        </Section>
      ) : (
        <EmptyLine>No tables yet. Start from a template below{canCreate ? " or a blank table" : ""}; Marketer can fill them in as it works.</EmptyLine>
      )}
      <Section title={tables.length ? "Start from a template" : "Templates"}>
        {templateGrid}
        {!canCreate && <NotAllowed className="mt-3">Owners, admins and marketers can create tables.</NotAllowed>}
      </Section>
    </Column>
  );
}
