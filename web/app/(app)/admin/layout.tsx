import { Shield } from "lucide-react";
import { Column, EmptyLine, PageHeader } from "@/design-system";
import { fetchAdminOverview, isForbidden } from "@/lib/admin-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Marketer" };

/**
 * Thin server-side guard for the whole /admin surface. We probe the admin
 * overview: a 403 means the caller is not an admin, so we render a clean
 * "not authorized" state and nothing else. Other failures don't masquerade
 * as an auth failure and don't throw: each page renders its own header
 * through AdminFrame and an EmptyLine when its fetch fails. The backend
 * enforces admin on every route, so a failed probe never exposes data.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let authorized = true;
  try {
    await fetchAdminOverview();
  } catch (err) {
    // Anything else (API down, timeout) is not an auth failure: let the page
    // render its own "couldn't load" line instead of throwing to the boundary.
    if (isForbidden(err)) authorized = false;
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
