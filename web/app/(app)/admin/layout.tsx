import { Shield } from "lucide-react";
import { AdminNav } from "@/components/mk/admin/admin-nav";
import { PageBody, PageHeader } from "@/components/mk/page";
import { Empty } from "@/components/mk/ui";
import { fetchAdminOverview, isForbidden } from "@/lib/admin-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Marketer" };

/**
 * Thin server-side guard for the whole /admin surface. We probe the admin
 * overview: a 403 means the caller is not an admin, so we render a clean
 * "not authorized" state and nothing else (no admin chrome, no hint of what
 * lives behind the wall). Other failures surface to the error boundary
 * rather than masquerading as an auth failure.
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
        <PageBody width="3xl">
          <Empty art="people" title="Not authorized">
            You don't have access to this area. If you believe this is a mistake, contact your workspace administrator.
          </Empty>
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader icon={<Shield />} title="Admin">
        <span className="hidden text-[13px] text-muted-foreground sm:inline">Every action here is audited</span>
      </PageHeader>
      <PageBody width="6xl">
        <AdminNav />
        <div className="space-y-6">{children}</div>
      </PageBody>
    </>
  );
}
