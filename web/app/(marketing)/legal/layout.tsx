import { LegalNav } from "@/components/marketing/legal/LegalNav";

export const dynamic = "force-dynamic";

// Two-column legal shell: a quiet sticky nav on the left, the document on the
// right. Lots of air; the marketing nav + footer come from the parent layout.
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-28 pt-28 sm:pt-36">
      <div className="grid gap-12 lg:grid-cols-[220px_1fr] lg:gap-20">
        <aside className="lg:sticky lg:top-32 lg:h-max">
          <p className="mb-4 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Legal
          </p>
          <LegalNav />
        </aside>
        <div>{children}</div>
      </div>
    </main>
  );
}
