import type { ReactNode } from "react";

import { LegalNav } from "@/components/marketing/legal/LegalNav";

export const dynamic = "force-dynamic";

export default function LegalLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-[1440px] px-5 pb-24 pt-28 sm:px-8 sm:pt-32 lg:px-10">
      <div className="grid gap-12 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-20">
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
            Legal
          </p>
          <LegalNav />
        </aside>
        <div>{children}</div>
      </div>
    </main>
  );
}
