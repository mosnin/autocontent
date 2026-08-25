import { LegalNav } from "@/components/marketing/legal/LegalNav";

export const dynamic = "force-dynamic";

// Two-column legal shell: a quiet sticky nav on the left, the document on
// the right, inside the same ruled section container the rest of the site
// uses. The nav + footer come from the parent marketing layout.
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="os-section os-section--top">
      <div className="os-section__inner">
        <div className="os-inset">
          <div className="os-legal-shell">
            <aside className="os-legal-shell__aside">
              <p className="os-label">Legal</p>
              <div className="os-mt-16">
                <LegalNav />
              </div>
            </aside>
            <div>{children}</div>
          </div>
        </div>
      </div>
    </main>
  );
}
