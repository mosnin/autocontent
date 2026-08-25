import type { ReactNode } from "react";

import { LegalNav } from "@/components/marketing/legal/LegalNav";

export const dynamic = "force-dynamic";

export default function LegalLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <main>
      <section
        className="px-5 pt-28 pb-14 sm:px-8 sm:pt-36 lg:px-10"
        style={{
          backgroundColor: "var(--surface)",
          color: "var(--surface-foreground)",
        }}
      >
        <div className="mx-auto max-w-[1440px]">
          <p className="text-[11px] font-medium tracking-wider uppercase opacity-60">
            Legal
          </p>
          <p className="mt-4 max-w-2xl text-[clamp(36px,5vw,64px)] leading-[1.04] font-medium tracking-tight">
            The rules, in writing.
          </p>
          <p className="mt-5 max-w-lg text-base leading-relaxed opacity-70">
            Terms, privacy, cookies, refunds, and the rest. These pages are the
            legal home for marketer.sh. They are not the marketing site in
            disguise.
          </p>
        </div>
      </section>

      <div className="mx-auto w-full max-w-[1440px] px-5 py-16 sm:px-8 lg:px-10">
        <div className="grid gap-12 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-20">
          <aside className="lg:sticky lg:top-28 lg:self-start">
            <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
              Documents
            </p>
            <LegalNav />
          </aside>
          <div>{children}</div>
        </div>
      </div>
    </main>
  );
}
