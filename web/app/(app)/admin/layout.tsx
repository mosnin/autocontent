import { Shield } from "lucide-react";
import { ButtonLink, Column, EmptyLine, PageHeader } from "@/design-system";
import { fetchAdminOverview, isForbidden } from "@/lib/admin-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Marketer" };

/**
 * Thin server-side guard for the whole /admin surface. We probe the admin
 * overview: a 403 means the caller is not an admin, so we render a clean
 * "not authorized" state and nothing else. Any other failure (API down,
 * timeout) fails closed too: we can't tell who is asking, so nothing under
 * /admin renders, but it is one quiet line, not a thrown error. Each page
 * renders its own header through AdminFrame.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let state: "ok" | "forbidden" | "unreachable" = "ok";
  try {
    await fetchAdminOverview();
  } catch (err) {
    state = isForbidden(err) ? "forbidden" : "unreachable";
  }

  if (state !== "ok") {
    return (
      <>
        <PageHeader icon={<Shield />} title="Admin" />
        <Column width="sm" title={state === "forbidden" ? "Not authorized" : "Admin is out of reach"}>
          {state === "forbidden" ? (
            <EmptyLine>You don&apos;t have access to this area. Ask your workspace administrator if this is a mistake.</EmptyLine>
          ) : (
            <EmptyLine action={<ButtonLink href="/home">Go home</ButtonLink>}>Couldn&apos;t reach the admin API to check your access. Refresh in a moment.</EmptyLine>
          )}
        </Column>
      </>
    );
  }

  return <>{children}</>;
}
