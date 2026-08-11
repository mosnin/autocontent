import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { PrivacyClient } from "./PrivacyClient";

export const dynamic = "force-dynamic";

// Data & privacy: GDPR data portability (export) and right to erasure
// (account deletion). The heavy lifting is client-side in PrivacyClient;
// here we only resolve the user's email for the delete confirmation.
export default async function PrivacyPage() {
  // Best-effort: if the lookup fails the delete dialog falls back to
  // requiring the word DELETE instead of the exact email.
  let email: string | null = null;
  try {
    const user = await api<User>("/api/v1/users/me");
    email = user.email;
  } catch {
    // ignore — client handles the null case
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
          Account
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Data &amp; privacy
        </h1>
        <p className="text-sm text-muted-foreground">
          Download everything we hold about you, or permanently delete your
          account. These controls put your GDPR rights to data portability and
          erasure in your hands.
        </p>
      </div>

      <PrivacyClient email={email} />
    </div>
  );
}
