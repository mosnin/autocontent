import { Shield } from "lucide-react";
import { Column, EmptyLine, PageHeader } from "@/design-system";
import { fetchAdminOverview, isForbidden } from "@/lib/admin-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Marketer" };

/**
 * Thin server-side guard for the whole /admin surface. We probe the admin
 * overview: a 403 means the caller is not an admin, so we render a clean
 * "not authorized" state and nothing else. Other failures surface to the
 * error boundary rather than masquerading as an auth failure. Each page
 * renders its own header through AdminFrame.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let authorized = true;
  try {
    await fetchAdminOverview();
  } catch (err) {
    if (isForbidden(err)) authorized = false;
    else throw err;
  }

  if (!authorized) {
    return (
      <>
        <PageHeader icon={<Shield />} title="Admin" />
        <Column width="sm" title="Not authorized">
          <EmptyLine>You don't have access to this area. Ask your workspace administrator if this is a mistake.</EmptyLine>
        </Column>
      </>
    );
  }

  return <>{children}</>;
}
