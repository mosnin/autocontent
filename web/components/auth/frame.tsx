import Link from "next/link";
import type { ReactNode } from "react";
import { AgentGlyph, cx } from "@/design-system";

/**
 * The frame every auth page shares: the Marketer mark, one narrow card with a
 * 22px title and one muted line, and a quiet footer line (ref 07 type scale).
 */
export function AuthFrame({ title, description, children, footer, wide }: { title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <main className="flex min-h-dvh flex-col items-center bg-ds-bg px-4 py-10 text-fg sm:justify-center">
      <Link href="/" className="mb-8 flex items-center gap-2 text-[14px] font-medium">
        <AgentGlyph size={22} /> Marketer
      </Link>
      <div className={cx("w-full rounded-ds-xl border border-hairline bg-surface p-6 sm:p-7", wide ? "max-w-[480px]" : "max-w-[400px]")}>
        <h1 className="text-[22px] font-medium leading-tight">{title}</h1>
        {description && <p className="mt-1.5 text-[13.5px] text-fg-muted">{description}</p>}
        <div className="mt-6 space-y-4">{children}</div>
      </div>
      {footer && <div className="mt-5 text-center text-[13px] text-fg-muted">{footer}</div>}
    </main>
  );
}

/** "or" between the password form and the other ways in. */
export function OrRule() {
  return (
    <div className="flex items-center gap-3 text-[12px] text-fg-faint" aria-hidden>
      <span className="h-px flex-1 bg-hairline" /> or <span className="h-px flex-1 bg-hairline" />
    </div>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-fg underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}
