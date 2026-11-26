import Link from "next/link";
import type { ReactNode } from "react";
import { AgentGlyph } from "@/design-system";

/**
 * The page every auth screen shares: the Marketer mark top left, one narrow
 * column in the middle holding one thing at a time (a StepFlow, or a single
 * static screen), and a quiet footer line. No card around it: the page is the
 * surface, like a system setup screen.
 */
export function AuthShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col bg-ds-bg text-fg">
      <header className="flex h-16 shrink-0 items-center px-5 sm:px-8">
        <Link href="/" className="ds-press flex items-center gap-2 rounded-ds-sm text-[14px] font-medium">
          <AgentGlyph size={22} /> Marketer
        </Link>
      </header>
      <div className="flex flex-1 flex-col items-center px-4 pb-10 pt-[4vh] sm:justify-center sm:pb-16 sm:pt-0">
        <div className="w-full max-w-[380px]">{children}</div>
      </div>
      {footer && <footer className="ds-enter shrink-0 px-4 pb-8 text-center text-[13.5px] text-fg-muted">{footer}</footer>}
    </main>
  );
}

/** One static auth screen (a link that failed, an invitation, two-factor setup): same shell, same type as a Step. */
export function AuthFrame({ title, description, children, footer, wide }: { title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <AuthShell footer={footer}>
      <div className={wide ? "sm:-mx-12" : undefined}>
        <div className="ds-stagger flex flex-col">
          <h1 className="text-[26px] font-medium leading-[1.15] tracking-[-0.022em]">{title}</h1>
          {description && <p className="mt-2 text-[15px] leading-relaxed text-fg-muted">{description}</p>}
          {children && <div className="mt-7 space-y-4">{children}</div>}
        </div>
      </div>
    </AuthShell>
  );
}

/** "or" between the main way in and the other ways. */
export function OrRule() {
  return (
    <div className="flex items-center gap-3 text-[12px] text-fg-faint" aria-hidden>
      <span className="h-px flex-1 bg-hairline" /> or <span className="h-px flex-1 bg-hairline" />
    </div>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-fg underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}
