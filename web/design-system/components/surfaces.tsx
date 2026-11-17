"use client";

/**
 * Surfaces: collection cards (ref 07), marketplace banner and app rows (ref 03),
 * plan options (ref 04), the home backdrop and glass bento cards (ref 01).
 */
import { Check, CheckCircle2, Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "../cx";
import { buttonClass } from "./primitives";
import { Shader, type Palette } from "./shader";

/** Ref 07 "Pipeline review": icon + 15px title, two-line description, footer. */
export function CollectionCard({ icon, title, description, footer, href, trailing, className }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; footer?: ReactNode; href?: string; trailing?: ReactNode; className?: string }) {
  const body = (
    <>
      <div className="flex items-start gap-2.5">
        {icon && <span className="mt-[1px] flex shrink-0 text-fg-muted [&_svg]:size-4">{icon}</span>}
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-medium">{title}</div>
          {description && <div className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-fg-muted">{description}</div>}
        </div>
        {trailing && <div className="shrink-0">{trailing}</div>}
      </div>
      {footer && <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-fg-muted">{footer}</div>}
    </>
  );
  const cls = cx("block rounded-ds-lg border border-hairline bg-surface p-4", href && "transition-colors hover:border-hairline-strong", className);
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Ref 03: a soft gradient banner holding example prompts as app-labelled pills. */
export function HeroBanner({ palette = "dusk", prompts, className }: { palette?: Palette; prompts: { app: string; icon?: ReactNode; text: string; href?: string }[]; className?: string }) {
  return (
    <div className={cx("relative overflow-hidden rounded-ds-xl", className)}>
      <div className="absolute inset-0">
        <Shader palette={palette} speed={0.5} />
      </div>
      <div className="relative flex flex-col items-end gap-2.5 px-5 py-8 sm:px-8">
        {prompts.map((p, i) => {
          const pill = (
            <span className="flex max-w-full items-center gap-2 rounded-full bg-white/90 py-1.5 pl-1.5 pr-4 text-[13px] text-neutral-900 shadow-sm backdrop-blur" style={{ marginRight: `${i * 18}px` }}>
              <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-on-fill px-2 py-0.5 text-[12.5px] font-medium text-on-fill-ink">
                {p.icon}
                {p.app}
              </span>
              <span className="truncate">{p.text}</span>
            </span>
          );
          return p.href ? (
            <Link key={i} href={p.href} className="max-w-full">
              {pill}
            </Link>
          ) : (
            <span key={i} className="max-w-full">
              {pill}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Ref 03 "Featured": logo tile, name, one-line purpose, + or ✓ on the right. */
export function AppRow({ logo, name, description, connected, onConnect, href }: { logo: ReactNode; name: string; description: string; connected?: boolean; onConnect?: () => void; href?: string }) {
  const action = connected ? (
    <span className="flex size-7 items-center justify-center text-fg-muted" aria-label="Connected" title="Connected">
      <Check className="size-4" />
    </span>
  ) : href ? (
    <Link href={href} aria-label={`Connect ${name}`} title={`Connect ${name}`} className="ds-press flex size-7 items-center justify-center rounded-ds-sm border border-hairline text-fg-muted hover:bg-surface-2 hover:text-fg">
      <Plus className="size-4" />
    </Link>
  ) : (
    <button type="button" onClick={onConnect} aria-label={`Connect ${name}`} title={`Connect ${name}`} className="ds-press flex size-7 items-center justify-center rounded-ds-sm border border-hairline text-fg-muted hover:bg-surface-2 hover:text-fg">
      <Plus className="size-4" />
    </button>
  );
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-ds-md border border-hairline bg-surface-2 [&_svg]:size-5">{logo}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium">{name}</div>
        <div className="truncate text-[13px] text-fg-muted">{description}</div>
      </div>
      {action}
    </div>
  );
}

/** Ref 04: textured image header, title + price badge, description, "What you get" checks, full-width CTA. */
export function PlanOption({ palette, title, price, description, features, cta, highlighted }: { palette: Palette; title: string; price: ReactNode; description: ReactNode; features: string[]; cta: { label: string; href?: string; onClick?: () => void; loading?: boolean }; highlighted?: boolean }) {
  const ctaCls = cx(buttonClass(highlighted ? "accent" : "secondary", "lg", "w-full rounded-full"));
  return (
    <div className="flex flex-col overflow-hidden rounded-ds-xl border border-hairline bg-surface">
      <div className="h-[120px]">
        <Shader palette={palette} speed={0.4} />
      </div>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[18px] font-medium">{title}</h3>
          <span className={cx("rounded-full px-2.5 py-0.5 text-[12.5px] font-medium", highlighted ? "bg-ds-accent/15 text-ds-accent" : "bg-surface-3 text-fg-muted")}>{price}</span>
        </div>
        <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">{description}</p>
        <div className="mt-6 text-[13px] font-medium">What you get:</div>
        <ul className="mt-2.5 flex-1 space-y-2">
          {features.map((f) => (
            <li key={f} className="flex items-center gap-2 text-[13.5px] text-fg-muted">
              <CheckCircle2 className="size-4 shrink-0" strokeWidth={1.6} /> {f}
            </li>
          ))}
        </ul>
        <div className="mt-8">
          {cta.href ? (
            <Link href={cta.href} className={ctaCls}>
              {cta.label}
            </Link>
          ) : (
            <button type="button" onClick={cta.onClick} disabled={cta.loading} className={ctaCls}>
              {cta.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Ref 01: the main area washed in shader light, content floating over it. */
export function Backdrop({ palette = "dusk", children }: { palette?: Palette; children: ReactNode }) {
  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto">
      <div className="pointer-events-none fixed inset-0 md:left-[248px]" aria-hidden>
        <div className="absolute inset-0 opacity-70">
          <Shader palette={palette} speed={0.35} />
        </div>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,hsl(var(--ds-bg)/0.55)_70%,hsl(var(--ds-bg))_100%)]" />
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}

/** Ref 01 bento card: translucent over the backdrop, icon + title header, footer link. */
export function GlassCard({ icon, title, children, footer, className }: { icon?: ReactNode; title?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <section className={cx("flex min-w-0 flex-col rounded-ds-lg border border-hairline p-3.5 backdrop-blur-md", className)} style={{ background: "var(--ds-glass)" }}>
      {title && (
        <div className="mb-3 flex items-center gap-1.5 text-[12.5px] text-fg-muted [&_svg]:size-3.5">
          {icon}
          {title}
        </div>
      )}
      <div className="min-h-0 flex-1">{children}</div>
      {footer && <div className="mt-3 text-[12.5px] text-fg-muted">{footer}</div>}
    </section>
  );
}
