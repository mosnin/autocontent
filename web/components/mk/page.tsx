/**
 * Page anatomy (ported from Podium's page.tsx). Every page is
 * PageHeader (the slim 50px bar) + PageBody, which opens with PageIntro.
 * Sections inside use SectionTitle, Card, Panel and List rows.
 */
import type { ReactNode } from "react";
import { EmptyArt, type EmptyArtKind } from "./empty-art";
import { cx } from "./ui";

export function PageHeader({ icon, title, children, className }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <header className={cx("flex h-[50px] shrink-0 items-center gap-2.5 border-b border-border px-5", className)}>
      {icon && <span className="flex text-muted-foreground [&_svg]:size-[16px] [&_svg]:stroke-[1.6]">{icon}</span>}
      <h1 className="min-w-0 truncate text-[15px] font-medium tracking-[-0.01em]">{title}</h1>
      {children && <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>}
    </header>
  );
}

/** Breadcrumb title for the header: "Content / Spring launch". */
export function Crumbs({ items }: { items: ReactNode[] }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {items.map((it, i) => (
        <span key={i} className={cx("truncate", i < items.length - 1 && "text-muted-foreground")}>
          {i > 0 && <span className="mr-1.5 text-faint">/</span>}
          {it}
        </span>
      ))}
    </span>
  );
}

export function PageBody({ children, width = "5xl", className }: { children: ReactNode; width?: "3xl" | "4xl" | "5xl" | "6xl" | "full"; className?: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div
        className={cx(
          "mx-auto px-5 pb-16 pt-8 sm:px-8 sm:pt-10",
          width === "3xl" && "max-w-3xl",
          width === "4xl" && "max-w-4xl",
          width === "5xl" && "max-w-5xl",
          width === "6xl" && "max-w-6xl",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function PageIntro({ title, children, action, className }: { title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("t-stagger mb-8 flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        <h2 className="text-[26px] font-medium leading-[1.15] tracking-[-0.022em]">{title}</h2>
        {children && <p className="mt-2.5 max-w-[62ch] text-[15px] leading-relaxed text-muted-foreground">{children}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/** The nested card: a soft frame with a quiet label holding a white card. */
export function Panel({ label, action, children, className, bodyClassName }: { label: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cx("rounded-[20px] border border-border bg-subtle p-1.5", className)}>
      <div className="flex min-h-9 items-center justify-between gap-3 px-3.5 pb-1.5 pt-1">
        <h2 className="text-[14px] font-normal text-muted-foreground">{label}</h2>
        {action}
      </div>
      <div className={cx("rounded-[14px] bg-card px-5 py-4 shadow-[0_0_0_0.5px_rgb(0_0_0/0.06),0_1px_2px_rgb(0_0_0/0.04)] dark:shadow-[inset_0_0_0_1px_hsl(var(--border))]", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Card({ className, children, inset }: { className?: string; children: ReactNode; inset?: boolean }) {
  return <div className={cx(inset ? "rounded-[14px] bg-subtle shadow-[inset_0_0_0_1px_hsl(var(--border))]" : "rounded-[20px] border border-border bg-card", className)}>{children}</div>;
}

/** A card with an icon + quiet title header, like the reference's "Recent sessions". */
export function TitledCard({ icon, title, action, children, className, footer }: { icon?: ReactNode; title: ReactNode; action?: ReactNode; children: ReactNode; className?: string; footer?: ReactNode }) {
  return (
    <section className={cx("flex flex-col rounded-[20px] border border-border bg-card", className)}>
      <div className="flex min-h-11 items-center gap-2 px-4 pt-1">
        {icon && <span className="flex text-muted-foreground [&_svg]:size-[15px] [&_svg]:stroke-[1.7]">{icon}</span>}
        <h2 className="text-[13px] font-normal text-muted-foreground">{title}</h2>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="min-h-0 flex-1 px-4 pb-4">{children}</div>
      {footer && <div className="border-t border-border px-4 py-2.5 text-[13px] text-muted-foreground">{footer}</div>}
    </section>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2.5 flex min-h-5 items-center justify-between gap-3">
      <h2 className="text-[13px] font-normal text-muted-foreground">{children}</h2>
      {action}
    </div>
  );
}

/** Rows inside one card, divided by hairlines. */
export function List({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-card", className)}>{children}</div>;
}

export function Row({ children, className, href }: { children: ReactNode; className?: string; href?: string }) {
  const cls = cx("flex min-h-[52px] items-center gap-3 px-4 py-2.5", href && "transition-colors duration-150 hover:bg-muted/50", className);
  return href ? (
    <a href={href} className={cls}>
      {children}
    </a>
  ) : (
    <div className={cls}>{children}</div>
  );
}

export function EmptyNote({ children, kind }: { children: ReactNode; kind?: EmptyArtKind }) {
  if (!kind) return <p className="rounded-[14px] bg-subtle px-4 py-5 text-[13px] text-muted-foreground">{children}</p>;
  return (
    <div className="flex items-center gap-4 rounded-[14px] bg-gradient-to-r from-sky/[0.08] via-sky/[0.03] to-transparent py-2 pl-2 pr-4">
      <EmptyArt kind={kind} size={76} className="shrink-0" />
      <p className="text-[13px] text-muted-foreground">{children}</p>
    </div>
  );
}

/** KPI tile: label, big number, delta, sparkbars. */
export function Stat({ label, value, delta, spark, icon }: { label: ReactNode; value: ReactNode; delta?: ReactNode; spark?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-3 rounded-[20px] border border-border bg-card px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground [&_svg]:size-[14px]">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[22px] font-medium tracking-[-0.02em] tabular">{value}</span>
          {delta}
        </div>
        {spark}
      </div>
    </div>
  );
}
