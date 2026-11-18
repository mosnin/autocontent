"use client";

/**
 * Layout: the window, sidebar parts, page header, toolbar and page bodies.
 * One dark window: sidebar and main divided by a hairline (refs 02, 05).
 */
import { ChevronsDown, ChevronsUpDown, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { cx } from "../cx";
import { Bullet, ProgressRing, WorkspaceLogo } from "./primitives";

/* ------------------------------------------------------------ Window */

export function Window({ sidebar, children, sidebarOpen = true }: { sidebar: ReactNode; children: ReactNode; sidebarOpen?: boolean }) {
  return (
    <div className="flex h-dvh overflow-hidden bg-ds-bg">
      {sidebarOpen && <aside className="hidden w-[248px] shrink-0 flex-col border-r border-hairline bg-ds-sidebar md:flex">{sidebar}</aside>}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}

/* ------------------------------------------------------------ Sidebar parts */

/** Workspace row (ref 05/07): logo, name, chevrons; actions on the right. */
export function WorkspaceRow({ name, href = "/home", actions }: { name: string; href?: string; actions?: ReactNode }) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 px-2.5">
      <Link href={href} className="ds-press flex min-w-0 flex-1 items-center gap-2 rounded-ds-sm px-1.5 py-1 hover:bg-surface-2">
        <WorkspaceLogo name={name} />
        <span className="truncate text-[13.5px] font-medium">{name}</span>
        <ChevronsUpDown className="size-3 shrink-0 text-fg-faint" />
      </Link>
      {actions}
    </div>
  );
}

/** A sidebar row (ref 05: 13px, 15px icon, 28px tall, current = surface-3 fill). */
export function SidebarRow({ href, icon, label, current, trailing, external, onClick }: { href: string; icon?: ReactNode; label: string; current?: boolean; trailing?: ReactNode; external?: boolean; onClick?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={current ? "page" : undefined}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className={cx(
        "ds-press flex h-7 items-center gap-2.5 rounded-ds-sm px-2 text-[13px] [&_svg]:size-[15px] [&_svg]:shrink-0 [&_svg]:stroke-[1.75]",
        current ? "bg-surface-3 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </Link>
  );
}

export function SidebarSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      {title && <div className="px-2 pb-1 text-[12px] text-fg-faint">{title}</div>}
      <div className="space-y-px">{children}</div>
    </div>
  );
}

/**
 * "Awaiting action" (ref 05): a bordered group of attention items with static
 * orange bullets and a "Show more" row. Nothing animates.
 */
export function SidebarAttention({ title, items, max = 3, onNavigate }: { title: string; items: { id: string; label: string; href: string }[]; max?: number; onNavigate?: () => void }) {
  const [all, setAll] = useState(false);
  if (items.length === 0) return null;
  const shown = all ? items : items.slice(0, max);
  return (
    <div className="mt-4 rounded-ds-md border border-hairline px-1 pb-1 pt-2">
      <div className="px-2 pb-1 text-[12px] text-fg-faint">{title}</div>
      {shown.map((it) => (
        <Link key={it.id} href={it.href} onClick={onNavigate} className="flex h-7 items-center gap-2.5 rounded-ds-sm px-2 text-[13px] text-fg hover:bg-surface-2">
          <Bullet tone="attention" />
          <span className="min-w-0 truncate">{it.label}</span>
        </Link>
      ))}
      {items.length > max && (
        <button type="button" aria-expanded={all} onClick={() => setAll((v) => !v)} className="flex h-7 w-full items-center gap-2.5 rounded-ds-sm px-2 text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg">
          <ChevronsDown className={cx("size-3.5 transition-transform duration-200", all && "rotate-180")} />
          {all ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

/** Plain text list rows for recents (ref 05 "Recents"). */
export function SidebarTextRow({ href, label, current, onClick }: { href: string; label: string; current?: boolean; onClick?: () => void }) {
  return (
    <Link href={href} onClick={onClick} className={cx("block truncate rounded-ds-sm px-2 py-1 text-[13px]", current ? "bg-surface-3 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg")}>
      {label}
    </Link>
  );
}

/** "Getting started 1 of 5" (ref 05): a bordered row with a progress arc. */
export function SidebarProgress({ label, done, total, onClick }: { label: string; done: number; total: number; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="ds-press flex h-8 w-full items-center gap-2 rounded-ds-md border border-hairline bg-surface px-2.5 text-[13px] hover:border-hairline-strong">
      <ProgressRing value={done / Math.max(1, total)} />
      <span className="flex-1 text-left">{label}</span>
      <span className="text-[12px] text-fg-faint tabular">
        {done} of {total}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------ Page header */
/* Ref 05: 48px bar, 15px icon + 14px medium title, actions on the right.
   Ref 02: breadcrumb "Chat / Generate on brand creative ···". */

export function PageHeader({ icon, title, crumbs, actions, menu, className }: { icon?: ReactNode; title?: ReactNode; crumbs?: { label: string; href?: string }[]; actions?: ReactNode; menu?: boolean; className?: string }) {
  return (
    <header className={cx("flex h-12 shrink-0 items-center gap-2 border-b border-hairline px-4", className)}>
      {icon && <span className="flex text-fg-muted [&_svg]:size-[15px] [&_svg]:stroke-[1.75]">{icon}</span>}
      {crumbs ? (
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13.5px]">
          {crumbs.map((c, i) => (
            <span key={i} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <span className="text-fg-faint">/</span>}
              {c.href ? (
                <Link href={c.href} className="truncate text-fg-muted hover:text-fg">
                  {c.label}
                </Link>
              ) : (
                <span className="truncate font-medium text-fg">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      ) : (
        <h1 className="min-w-0 truncate text-[14px] font-medium">{title}</h1>
      )}
      {menu && <MoreHorizontal aria-hidden className="size-4 shrink-0 text-fg-faint" />}
      {actions && <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div>}
    </header>
  );
}

/** Filter row under the header (ref 05: pills left, "Manage metrics" right). */
export function Toolbar({ children, end }: { children: ReactNode; end?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
      {children}
      {end && <div className="ml-auto flex items-center gap-1.5">{end}</div>}
    </div>
  );
}

/* ------------------------------------------------------------ Page bodies */

/** Dashboard body (ref 05): full width, 16px gutters, cards in a grid. */
export function Canvas({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={cx("space-y-3 p-4", className)}>{children}</div>
    </div>
  );
}

/**
 * Collection body (ref 07): one centered column. Title 22px, one muted line,
 * an optional segmented control, then sections.
 */
export function Column({ title, description, control, actions, children, width = "md" }: { title?: ReactNode; description?: ReactNode; control?: ReactNode; actions?: ReactNode; children: ReactNode; width?: "sm" | "md" | "lg" }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={cx("mx-auto px-5 pb-20 pt-12 sm:px-6", width === "sm" && "max-w-[560px]", width === "md" && "max-w-[720px]", width === "lg" && "max-w-[960px]")}>
        {(title || actions) && (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              {title && <h2 className="text-[22px] font-medium leading-tight">{title}</h2>}
              {description && <p className="mt-1.5 text-[14px] text-fg-muted">{description}</p>}
            </div>
            {actions && <div className="flex items-center gap-1.5">{actions}</div>}
          </div>
        )}
        {control && <div className="mt-5">{control}</div>}
        <div className="mt-8 space-y-10">{children}</div>
      </div>
    </div>
  );
}

/** Section inside a Column (ref 07 "Recommended", "New skills"). */
export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[14px] font-medium text-fg-muted">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Bordered card (ref 05 cards, ref 07 skill cards). */
export function Card({ children, className, as: As = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" }) {
  return <As className={cx("rounded-ds-lg border border-hairline bg-surface", className)}>{children}</As>;
}

/** Rows inside one bordered card, divided by hairlines. */
export function List({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("divide-y divide-hairline overflow-hidden rounded-ds-lg border border-hairline bg-surface", className)}>{children}</div>;
}

export function ListRow({ children, href, className }: { children: ReactNode; href?: string; className?: string }) {
  const cls = cx("flex min-h-12 items-center gap-3 px-3.5 py-2.5", href && "-outline-offset-2 hover:bg-surface-2", className);
  return href ? (
    <Link href={href} className={cls}>
      {children}
    </Link>
  ) : (
    <div className={cls}>{children}</div>
  );
}

/** Quiet empty line: what will appear here, and optionally one action. No illustrations, no dashed boxes. */
export function EmptyLine({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-ds-lg border border-hairline px-4 py-6 text-[13px] text-fg-muted">
      <span>{children}</span>
      {action}
    </div>
  );
}
