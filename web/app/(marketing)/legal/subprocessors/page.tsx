import type { Metadata } from "next";

import { LegalDoc } from "@/components/marketing/legal/LegalDoc";

export const metadata: Metadata = {
  title: "Subprocessors · marketer.sh",
  description: "Third parties that process data on behalf of marketer.sh.",
};

const ROWS: { name: string; purpose: string; region: string }[] = [
  { name: "Cloud hosting & serverless runtime", purpose: "Application hosting, pipeline execution, storage", region: "United States" },
  { name: "Managed Postgres", purpose: "Primary application database (encrypted at rest)", region: "United States" },
  { name: "Authentication provider", purpose: "Sign-in, sessions, and identity", region: "United States" },
  { name: "Payment processor", purpose: "Card payments and prepaid credit purchases", region: "United States" },
  { name: "Payment facilitator (x402)", purpose: "Verification and settlement of agent stablecoin payments", region: "Global" },
  { name: "Model & media providers", purpose: "Text, image, video, and speech generation", region: "United States" },
  { name: "Search / research provider", purpose: "SERP analysis for article research", region: "United States" },
  { name: "Ad platforms & connectors", purpose: "Publishing and paid campaign management you authorize", region: "Global" },
  { name: "Transactional email", purpose: "Notifications and account email", region: "United States" },
  { name: "Error & performance monitoring", purpose: "Diagnostics and reliability", region: "United States" },
];

export default function SubprocessorsPage() {
  return (
    <LegalDoc
      title="Subprocessors"
      intro="These third parties process data on our behalf to run the service. We require each to protect data under terms consistent with our commitments to you. We update this list before adding a subprocessor that materially affects your data."
    >
      <h2>Current subprocessors</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Category</th>
              <th className="py-2 pr-4 font-medium">Purpose</th>
              <th className="py-2 font-medium">Region</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.name} className="border-b border-border/60 align-top">
                <td className="py-3 pr-4 font-medium text-foreground">{r.name}</td>
                <td className="py-3 pr-4 text-foreground/90">{r.purpose}</td>
                <td className="py-3 text-muted-foreground">{r.region}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Notice of changes</h2>
      <p>
        To be notified of updates to this list, email{" "}
        <a href="mailto:privacy@marketer.sh">privacy@marketer.sh</a>. Data
        handling by these parties is covered by our{" "}
        <a href="/legal/privacy">Privacy Policy</a> and, for business customers,
        our <a href="/legal/dpa">Data Processing Addendum</a>.
      </p>
    </LegalDoc>
  );
}
